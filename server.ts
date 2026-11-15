import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractSpotifyPlaylistId,
  extractYouTubePlaylistId,
  generateUniqueTickets,
  verifyClaimAgainstPlayedSongs,
} from './src/shared/gameLogic.ts';
import type { TicketCell, TrackItem, WinningPattern } from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig | null {
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as FirebaseAppletConfig;
  } catch {
    return null;
  }
}

function getAppBaseUrl(): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

interface SpotifySession {
  ownerUid: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: {
    id: string;
    displayName: string;
    product: string;
  };
}

interface YouTubeSession {
  ownerUid: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: {
    displayName: string;
  };
}

interface PendingOAuthState {
  provider: 'spotify' | 'youtube';
  ownerUid: string;
  codeVerifier: string;
  createdAt: number;
}

const spotifySessions = new Map<string, SpotifySession>();
const youtubeSessions = new Map<string, YouTubeSession>();
const oauthStates = new Map<string, PendingOAuthState>();

let spotifyAppToken: { accessToken: string; expiresAt: number } | null = null;
const tokenUidCache = new Map<string, { uid: string; expiresAt: number }>();

function cleanExpiredStates() {
  const now = Date.now();
  for (const [state, entry] of oauthStates.entries()) {
    if (now - entry.createdAt > 10 * 60 * 1000) {
      oauthStates.delete(state);
    }
  }
  for (const [hash, cached] of tokenUidCache.entries()) {
    if (cached.expiresAt <= now) {
      tokenUidCache.delete(hash);
    }
  }
}

function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

async function verifyFirebaseAuth(
  req: Request,
): Promise<{ uid: string; idToken: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) return null;

  const tokenHash = crypto.createHash('sha256').update(idToken).digest('hex');
  const cached = tokenUidCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) {
    return { uid: cached.uid, idToken };
  }

  const fbConfig = loadFirebaseConfig();
  if (!fbConfig?.apiKey) return null;

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fbConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { users?: Array<{ localId?: string }> };
    const uid = json.users?.[0]?.localId;
    if (!uid) return null;

    tokenUidCache.set(tokenHash, { uid, expiresAt: Date.now() + 30_000 });
    return { uid, idToken };
  } catch {
    return null;
  }
}

// Decode Firestore REST API document fields into plain JS values
function decodeFirestoreValue(val: Record<string, unknown>): unknown {
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    const arr = val.arrayValue as { values?: Record<string, unknown>[] };
    return (arr.values || []).map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const map = val.mapValue as { fields?: Record<string, Record<string, unknown>> };
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map.fields || {})) {
      result[k] = decodeFirestoreValue(v);
    }
    return result;
  }
  return undefined;
}

async function fetchFirestoreDocument(
  config: FirebaseAppletConfig,
  docPath: string,
  bearerToken: string,
): Promise<Record<string, unknown>> {
  const dbId = config.firestoreDatabaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/${encodeURIComponent(dbId)}/documents/${docPath}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST error (${resp.status}) at ${docPath}: ${errText}`);
  }
  const json = (await resp.json()) as { fields?: Record<string, Record<string, unknown>> };
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json.fields || {})) {
    decoded[k] = decodeFirestoreValue(v);
  }
  return decoded;
}

async function fetchFirestoreDocumentOptional(
  config: FirebaseAppletConfig,
  docPath: string,
  bearerToken: string,
): Promise<Record<string, unknown> | null> {
  const dbId = config.firestoreDatabaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/${encodeURIComponent(dbId)}/documents/${docPath}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore REST error (${resp.status}) at ${docPath}: ${errText}`);
  }
  const json = (await resp.json()) as { fields?: Record<string, Record<string, unknown>> };
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json.fields || {})) {
    decoded[k] = decodeFirestoreValue(v);
  }
  return decoded;
}

const roomVerificationLocks = new Map<string, Promise<unknown>>();
const roomLastProcessedTs = new Map<string, number>();

function withRoomVerificationLock<T>(roomCode: string, task: () => Promise<T>): Promise<T> {
  const previous = roomVerificationLocks.get(roomCode) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  const cleanup = next.catch(() => undefined).finally(() => {
    if (roomVerificationLocks.get(roomCode) === cleanup) {
      roomVerificationLocks.delete(roomCode);
    }
  });
  roomVerificationLocks.set(roomCode, cleanup);
  return next;
}

async function verifyRoomHostOwnership(
  roomCode: string,
  uid: string,
  idToken: string,
): Promise<boolean> {
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return false;
  const fbConfig = loadFirebaseConfig();
  if (!fbConfig?.projectId) return false;
  try {
    const roomDoc = await fetchFirestoreDocument(fbConfig, `rooms/${roomCode}`, idToken);
    return roomDoc.hostUid === uid;
  } catch {
    return false;
  }
}

async function getSpotifyAppAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (spotifyAppToken && spotifyAppToken.expiresAt > Date.now()) {
    return spotifyAppToken.accessToken;
  }

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  spotifyAppToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return spotifyAppToken.accessToken;
}

async function getHostSpotifySession(
  req: Request,
  ownerUid: string,
): Promise<SpotifySession | null> {
  const sid = req.cookies?.mh_spotify_sid as string | undefined;
  if (!sid) return null;
  const session = spotifySessions.get(sid);
  if (!session || session.ownerUid !== ownerUid) {
    return null;
  }

  if (session.expiresAt > Date.now()) {
    return session;
  }

  // Refresh server-side without ever exposing refresh token to browser
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!session.refreshToken || !clientId || !clientSecret) {
    spotifySessions.delete(sid);
    return null;
  }

  try {
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      }),
    });
    if (!resp.ok) {
      spotifySessions.delete(sid);
      return null;
    }
    const tokenJson = (await resp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    session.accessToken = tokenJson.access_token;
    if (tokenJson.refresh_token) session.refreshToken = tokenJson.refresh_token;
    session.expiresAt = Date.now() + (tokenJson.expires_in - 60) * 1000;
    return session;
  } catch {
    spotifySessions.delete(sid);
    return null;
  }
}

async function getHostYouTubeSession(
  req: Request,
  ownerUid: string,
): Promise<YouTubeSession | null> {
  const sid = req.cookies?.mh_yt_sid as string | undefined;
  if (!sid) return null;
  const session = youtubeSessions.get(sid);
  if (!session || session.ownerUid !== ownerUid) {
    return null;
  }

  if (session.expiresAt > Date.now()) {
    return session;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!session.refreshToken || !clientId || !clientSecret) {
    youtubeSessions.delete(sid);
    return null;
  }

  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: session.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!resp.ok) {
      youtubeSessions.delete(sid);
      return null;
    }
    const tokenJson = (await resp.json()) as {
      access_token: string;
      expires_in: number;
    };
    session.accessToken = tokenJson.access_token;
    session.expiresAt = Date.now() + (tokenJson.expires_in - 60) * 1000;
    return session;
  } catch {
    youtubeSessions.delete(sid);
    return null;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Health & capability status endpoint (no secrets exposed)
  app.get('/api/health', (_req: Request, res: Response) => {
    const fbConfig = loadFirebaseConfig();
    res.json({
      ok: true,
      firebaseConfigured: Boolean(fbConfig?.projectId),
      youtubeApiConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
      youtubeOAuthConfigured: Boolean(
        process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
          process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
      ),
      spotifyConfigured: Boolean(
        process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim(),
      ),
    });
  });

  // Host-scoped YouTube authorization status
  app.get('/api/youtube/status', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseAuth(req);
    const oauthConfigured = Boolean(
      process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    );
    const session = authUser ? await getHostYouTubeSession(req, authUser.uid) : null;

    res.json({
      apiKeyConfigured: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
      oauthConfigured,
      connected: Boolean(session),
      user: session ? session.user : null,
    });
  });

  // Google/YouTube OAuth Authorization Code + PKCE URL (used only when private playlist access requires it)
  app.get('/api/youtube/auth-url', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseAuth(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required to link YouTube.' });
      return;
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res.status(503).json({
        error:
          'Private YouTube playlist authorization is not enabled on this server. Set the playlist to Unlisted or Public to load it without signing in.',
      });
      return;
    }

    cleanExpiredStates();
    const state = crypto.randomBytes(16).toString('hex');
    const { codeVerifier, codeChallenge } = createPkcePair();
    oauthStates.set(state, {
      provider: 'youtube',
      ownerUid: authUser.uid,
      codeVerifier,
      createdAt: Date.now(),
    });

    const redirectUri = `${getAppBaseUrl()}/auth/youtube/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });

    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  });

  // Google/YouTube OAuth Callback
  app.get(
    ['/auth/youtube/callback', '/auth/youtube/callback/'],
    async (req: Request, res: Response) => {
      const { code, state, error } = req.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      const pending = state ? oauthStates.get(state) : undefined;
      if (error || !code || !state || !pending || pending.provider !== 'youtube') {
        res.status(400).send(`
          <html>
            <body style="font-family:sans-serif;background:#090D1A;color:#fff;padding:32px;">
              <h2>YouTube Authorization Cancelled or Invalid</h2>
              <p>${error ? String(error) : 'Missing or expired authorization state.'}</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'YOUTUBE_OAUTH_ERROR', error: 'Authorization failed' }, '*');
                  setTimeout(() => window.close(), 1200);
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      oauthStates.delete(state);

      try {
        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID!.trim();
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!.trim();
        const redirectUri = `${getAppBaseUrl()}/auth/youtube/callback`;

        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            code_verifier: pending.codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }),
        });

        if (!tokenResp.ok) {
          const errBody = await tokenResp.text();
          throw new Error(`Google token exchange failed: ${errBody}`);
        }

        const tokenJson = (await tokenResp.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
        };

        let displayName = 'YouTube Account';
        try {
          const chanResp = await fetch(
            'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
            {
              headers: { Authorization: `Bearer ${tokenJson.access_token}` },
            },
          );
          if (chanResp.ok) {
            const chanJson = (await chanResp.json()) as {
              items?: Array<{ snippet?: { title?: string } }>;
            };
            displayName = chanJson.items?.[0]?.snippet?.title || displayName;
          }
        } catch {
          // Optional channel label
        }

        const sid = crypto.randomBytes(24).toString('hex');
        youtubeSessions.set(sid, {
          ownerUid: pending.ownerUid,
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          expiresAt: Date.now() + (tokenJson.expires_in - 60) * 1000,
          user: { displayName },
        });

        res.cookie('mh_yt_sid', sid, {
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          maxAge: 24 * 3600 * 1000,
        });

        res.send(`
          <html>
            <body style="font-family:sans-serif;background:#090D1A;color:#fff;padding:32px;">
              <p>YouTube connected successfully. Closing window...</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'YOUTUBE_OAUTH_SUCCESS' }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              </script>
            </body>
          </html>
        `);
      } catch (err) {
        res.status(500).send(`
          <html>
            <body style="font-family:sans-serif;background:#090D1A;color:#fff;padding:32px;">
              <h2>YouTube Connection Failed</h2>
              <p>${err instanceof Error ? err.message : 'Unknown error'}</p>
            </body>
          </html>
        `);
      }
    },
  );

  app.post('/api/youtube/disconnect', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseAuth(req);
    const sid = req.cookies?.mh_yt_sid as string | undefined;
    if (sid && authUser) {
      const session = youtubeSessions.get(sid);
      if (session && session.ownerUid === authUser.uid) {
        youtubeSessions.delete(sid);
      }
    }
    res.clearCookie('mh_yt_sid', { secure: true, sameSite: 'none' });
    res.json({ ok: true });
  });

  // Official YouTube Data API v3 playlist loader (app owner API key for public, host OAuth for private)
  app.post('/api/youtube/playlist', async (req: Request, res: Response) => {
    try {
      const authUser = await verifyFirebaseAuth(req);
      if (!authUser) {
        res.status(401).json({ error: 'Authentication required to load playlist.' });
        return;
      }

      const { playlistUrl, roomCode } = req.body as {
        playlistUrl?: string;
        roomCode?: string;
      };

      if (roomCode) {
        const isHost = await verifyRoomHostOwnership(roomCode, authUser.uid, authUser.idToken);
        if (!isHost) {
          res.status(403).json({ error: 'Only the room host can update the playlist.' });
          return;
        }
      }

      if (!playlistUrl || typeof playlistUrl !== 'string') {
        res.status(400).json({ error: 'Please provide a YouTube playlist URL.' });
        return;
      }

      const playlistId = extractYouTubePlaylistId(playlistUrl);
      if (!playlistId) {
        res.status(400).json({
          error:
            'Invalid YouTube playlist URL. Make sure the URL contains a "?list=..." playlist parameter.',
        });
        return;
      }

      const ytSession = authUser ? await getHostYouTubeSession(req, authUser.uid) : null;
      const apiKey = process.env.YOUTUBE_API_KEY?.trim();
      const oauthConfigured = Boolean(
        process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
          process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
      );

      if (!ytSession && !apiKey) {
        res.json({
          ok: false,
          code: 'YOUTUBE_API_KEY_MISSING',
          playlistId,
          oauthConfigured,
          message: 'Falling back to official YouTube IFrame Player + oEmbed loader.',
        });
        return;
      }

      const ytHeaders: Record<string, string> = {};
      const appendAuth = (url: URL) => {
        if (ytSession) {
          ytHeaders.Authorization = `Bearer ${ytSession.accessToken}`;
        } else if (apiKey) {
          url.searchParams.set('key', apiKey);
        }
      };

      // 1. Fetch playlist metadata
      const metaUrl = new URL('https://www.googleapis.com/youtube/v3/playlists');
      metaUrl.searchParams.set('part', 'snippet,status');
      metaUrl.searchParams.set('id', playlistId);
      appendAuth(metaUrl);

      const metaResp = await fetch(metaUrl.toString(), { headers: ytHeaders });
      const metaData = (await metaResp.json()) as {
        error?: { message?: string; code?: number };
        items?: Array<{
          snippet?: { title?: string; channelTitle?: string };
          status?: { privacyStatus?: string };
        }>;
      };

      if (!metaResp.ok) {
        if ((metaResp.status === 403 || metaResp.status === 404) && !ytSession) {
          res.status(403).json({
            code: 'PRIVATE_PLAYLIST_AUTH_REQUIRED',
            requiresYouTubeAuth: true,
            oauthConfigured,
            error:
              'This YouTube playlist is private or restricted. Connect your Google/YouTube account to access private playlists, or set the playlist visibility to Unlisted or Public.',
          });
          return;
        }
        res.status(metaResp.status === 403 ? 403 : 502).json({
          error: metaData.error?.message || 'YouTube Data API request failed.',
        });
        return;
      }

      const playlistItem = metaData.items?.[0];
      if (!playlistItem) {
        if (!ytSession) {
          res.status(403).json({
            code: 'PRIVATE_PLAYLIST_AUTH_REQUIRED',
            requiresYouTubeAuth: true,
            oauthConfigured,
            error:
              'Playlist not found or is set to Private. Connect your Google/YouTube account to access your private playlists, or set the playlist to Public or Unlisted.',
          });
          return;
        }
        res.status(404).json({
          error:
            'Playlist not found or your connected Google/YouTube account does not have permission to view it.',
        });
        return;
      }

      const playlistName = playlistItem.snippet?.title || 'YouTube Playlist';

      // 2. Fetch playlist items (up to 4 pages = 200 items)
      const rawItems: Array<{
        videoId: string;
        title: string;
        artist: string;
        thumbnailUrl?: string;
      }> = [];
      let nextPageToken: string | undefined;

      for (let page = 0; page < 4; page++) {
        const itemsUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
        itemsUrl.searchParams.set('part', 'snippet,status');
        itemsUrl.searchParams.set('playlistId', playlistId);
        itemsUrl.searchParams.set('maxResults', '50');
        appendAuth(itemsUrl);
        if (nextPageToken) itemsUrl.searchParams.set('pageToken', nextPageToken);

        const itemsResp = await fetch(itemsUrl.toString(), { headers: ytHeaders });
        if (!itemsResp.ok) break;
        const itemsJson = (await itemsResp.json()) as {
          nextPageToken?: string;
          items?: Array<{
            snippet?: {
              title?: string;
              videoOwnerChannelTitle?: string;
              resourceId?: { videoId?: string };
              thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
            };
            status?: { privacyStatus?: string };
          }>;
        };

        for (const item of itemsJson.items || []) {
          const videoId = item.snippet?.resourceId?.videoId;
          const title = item.snippet?.title || '';
          const privacy = item.status?.privacyStatus;
          if (
            videoId &&
            (ytSession || privacy !== 'private') &&
            title !== 'Private video' &&
            title !== 'Deleted video'
          ) {
            rawItems.push({
              videoId,
              title,
              artist: (item.snippet?.videoOwnerChannelTitle || 'YouTube').replace(/\s*-\s*Topic$/, ''),
              thumbnailUrl:
                item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
            });
          }
        }

        nextPageToken = itemsJson.nextPageToken;
        if (!nextPageToken) break;
      }

      if (rawItems.length === 0) {
        res.status(400).json({
          error: 'This YouTube playlist has no accessible videos.',
        });
        return;
      }

      // 3. Verify embeddability via videos endpoint in chunks of 50
      const embeddableIds = new Set<string>();
      for (let i = 0; i < rawItems.length; i += 50) {
        const chunk = rawItems.slice(i, i + 50).map((x) => x.videoId);
        const vidUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
        vidUrl.searchParams.set('part', 'status');
        vidUrl.searchParams.set('id', chunk.join(','));
        appendAuth(vidUrl);

        const vidResp = await fetch(vidUrl.toString(), { headers: ytHeaders });
        if (vidResp.ok) {
          const vidJson = (await vidResp.json()) as {
            items?: Array<{
              id: string;
              status?: { embeddable?: boolean; privacyStatus?: string };
            }>;
          };
          for (const v of vidJson.items || []) {
            if (v.status?.embeddable !== false && (ytSession || v.status?.privacyStatus !== 'private')) {
              embeddableIds.add(v.id);
            }
          }
        }
      }

      const seen = new Set<string>();
      const tracks: TrackItem[] = [];
      for (const item of rawItems) {
        if (!embeddableIds.has(item.videoId)) continue;
        if (seen.has(item.videoId)) continue;
        seen.add(item.videoId);
        tracks.push({
          id: `yt_${item.videoId}`,
          title: item.title,
          artist: item.artist,
          sourceId: item.videoId,
          sourceType: 'youtube',
          thumbnailUrl: item.thumbnailUrl,
        });
      }

      const skippedCount = rawItems.length - tracks.length;
      res.json({
        ok: true,
        sourceType: 'youtube',
        playlistId,
        playlistName,
        totalFound: rawItems.length,
        skippedRestricted: skippedCount,
        tracks,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load YouTube playlist.',
      });
    }
  });

  // Official YouTube oEmbed resolver for playlists loaded via YouTube IFrame Player API
  app.post('/api/youtube/oembed', async (req: Request, res: Response) => {
    try {
      const { videoIds } = req.body as { videoIds?: string[] };
      if (!Array.isArray(videoIds) || videoIds.length === 0) {
        res.status(400).json({ error: 'No video IDs provided.' });
        return;
      }

      const uniqueIds = Array.from(
        new Set(videoIds.filter((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{6,20}$/.test(id))),
      ).slice(0, 100);

      const tracks: TrackItem[] = [];
      let skipped = 0;

      for (let i = 0; i < uniqueIds.length; i += 10) {
        const batch = uniqueIds.slice(i, i + 10);
        const results = await Promise.all(
          batch.map(async (videoId) => {
            try {
              const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
              const resp = await fetch(oembedUrl);
              if (!resp.ok) return null;
              const data = (await resp.json()) as {
                title?: string;
                author_name?: string;
                thumbnail_url?: string;
              };
              if (!data.title) return null;
              return {
                id: `yt_${videoId}`,
                title: data.title,
                artist: (data.author_name || 'YouTube').replace(/\s*-\s*Topic$/, ''),
                sourceId: videoId,
                sourceType: 'youtube' as const,
                thumbnailUrl: data.thumbnail_url,
              };
            } catch {
              return null;
            }
          }),
        );

        for (const item of results) {
          if (item) {
            tracks.push(item);
          } else {
            skipped++;
          }
        }
      }

      res.json({
        ok: true,
        tracks,
        skippedRestricted: skipped,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to resolve YouTube metadata.',
      });
    }
  });

  // Host-scoped Spotify OAuth Status (never leaks tokens or client secret)
  app.get('/api/spotify/status', async (req: Request, res: Response) => {
    const configured = Boolean(
      process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim(),
    );
    const authUser = await verifyFirebaseAuth(req);
    const session = authUser ? await getHostSpotifySession(req, authUser.uid) : null;

    res.json({
      configured,
      connected: Boolean(session),
      user: session ? session.user : null,
    });
  });

  // Spotify OAuth Authorization Code + PKCE URL generator (bound to host Firebase UID)
  app.get('/api/spotify/auth-url', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseAuth(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required to connect Spotify.' });
      return;
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res.status(503).json({
        error: 'Spotify integration is not configured on this server.',
      });
      return;
    }

    cleanExpiredStates();
    const state = crypto.randomBytes(16).toString('hex');
    const { codeVerifier, codeChallenge } = createPkcePair();
    oauthStates.set(state, {
      provider: 'spotify',
      ownerUid: authUser.uid,
      codeVerifier,
      createdAt: Date.now(),
    });

    const redirectUri = `${getAppBaseUrl()}/auth/spotify/callback`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'playlist-read-private playlist-read-collaborative user-read-private',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      show_dialog: 'true',
    });

    res.json({ url: `https://accounts.spotify.com/authorize?${params.toString()}` });
  });

  // Spotify OAuth Callback (validates state, exchanges code + PKCE verifier + client secret)
  app.get(
    ['/auth/spotify/callback', '/auth/spotify/callback/'],
    async (req: Request, res: Response) => {
      const { code, state, error } = req.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      const pending = state ? oauthStates.get(state) : undefined;
      if (error || !code || !state || !pending || pending.provider !== 'spotify') {
        res.status(400).send(`
          <html>
            <body style="font-family:sans-serif;background:#090D1A;color:#fff;padding:32px;">
              <h2>Spotify Authorization Cancelled or Invalid</h2>
              <p>${error ? String(error) : 'Missing or expired authorization state.'}</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'SPOTIFY_OAUTH_ERROR', error: 'Authorization failed' }, '*');
                  setTimeout(() => window.close(), 1200);
                }
              </script>
            </body>
          </html>
        `);
        return;
      }

      oauthStates.delete(state);

      try {
        const clientId = process.env.SPOTIFY_CLIENT_ID!.trim();
        const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!.trim();
        const redirectUri = `${getAppBaseUrl()}/auth/spotify/callback`;

        const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: pending.codeVerifier,
          }),
        });

        if (!tokenResp.ok) {
          const errBody = await tokenResp.text();
          throw new Error(`Spotify token exchange failed: ${errBody}`);
        }

        const tokenJson = (await tokenResp.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
        };

        const meResp = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });

        const meJson = meResp.ok
          ? ((await meResp.json()) as { id?: string; display_name?: string; product?: string })
          : { id: 'spotify_user', display_name: 'Spotify Listener', product: 'free' };

        const sid = crypto.randomBytes(24).toString('hex');
        spotifySessions.set(sid, {
          ownerUid: pending.ownerUid,
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          expiresAt: Date.now() + (tokenJson.expires_in - 60) * 1000,
          user: {
            id: meJson.id || 'spotify_user',
            displayName: meJson.display_name || 'Spotify User',
            product: meJson.product || 'free',
          },
        });

        res.cookie('mh_spotify_sid', sid, {
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          maxAge: 24 * 3600 * 1000,
        });

        res.send(`
          <html>
            <body style="font-family:sans-serif;background:#090D1A;color:#fff;padding:32px;">
              <p>Spotify connected successfully. Closing window...</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'SPOTIFY_OAUTH_SUCCESS' }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              </script>
            </body>
          </html>
        `);
      } catch (err) {
        res.status(500).send(`
          <html>
            <body style="font-family:sans-serif;background:#090D1A;color:#fff;padding:32px;">
              <h2>Spotify Connection Failed</h2>
              <p>${err instanceof Error ? err.message : 'Unknown error'}</p>
            </body>
          </html>
        `);
      }
    },
  );

  app.post('/api/spotify/disconnect', async (req: Request, res: Response) => {
    const authUser = await verifyFirebaseAuth(req);
    const sid = req.cookies?.mh_spotify_sid as string | undefined;
    if (sid && authUser) {
      const session = spotifySessions.get(sid);
      if (session && session.ownerUid === authUser.uid) {
        spotifySessions.delete(sid);
      }
    }
    res.clearCookie('mh_spotify_sid', { secure: true, sameSite: 'none' });
    res.json({ ok: true });
  });

  // Official Spotify Playlist Metadata API (uses App Client Credentials for public, Host OAuth for private)
  app.post('/api/spotify/playlist', async (req: Request, res: Response) => {
    try {
      const authUser = await verifyFirebaseAuth(req);
      if (!authUser) {
        res.status(401).json({ error: 'Authentication required to load playlist.' });
        return;
      }

      const { playlistUrl, roomCode } = req.body as {
        playlistUrl?: string;
        roomCode?: string;
      };

      if (roomCode) {
        const isHost = await verifyRoomHostOwnership(roomCode, authUser.uid, authUser.idToken);
        if (!isHost) {
          res.status(403).json({ error: 'Only the room host can update the playlist.' });
          return;
        }
      }

      const configured = Boolean(
        process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim(),
      );
      if (!configured) {
        res.status(503).json({
          error:
            'Spotify playlist import is not enabled on this server. Please use a YouTube playlist instead.',
        });
        return;
      }

      if (!playlistUrl || typeof playlistUrl !== 'string') {
        res.status(400).json({ error: 'Please provide a Spotify playlist URL.' });
        return;
      }

      const playlistId = extractSpotifyPlaylistId(playlistUrl);
      if (!playlistId) {
        res.status(400).json({
          error:
            'Invalid Spotify playlist URL. Expected a link like https://open.spotify.com/playlist/...',
        });
        return;
      }

      const hostSession = await getHostSpotifySession(req, authUser.uid);
      const accessToken = hostSession
        ? hostSession.accessToken
        : await getSpotifyAppAccessToken();

      if (!accessToken) {
        res.status(502).json({
          error: 'Could not authorize with Spotify right now. Please try again or use YouTube.',
        });
        return;
      }

      const plResp = await fetch(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=name,public,tracks.total,tracks.next,tracks.items(is_local,track(id,name,preview_url,artists(name),album(images)))`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!plResp.ok) {
        if (plResp.status === 401 || plResp.status === 403 || plResp.status === 404) {
          if (!hostSession) {
            res.status(403).json({
              requiresSpotifyAuth: true,
              error:
                'This Spotify playlist is private or restricted. Connect your Spotify account to load your private playlists, or use a public playlist / YouTube.',
            });
            return;
          }
          res.status(plResp.status).json({
            error:
              'Spotify restricted access to this playlist. Note: Spotify Web API restricts algorithmic/editorial Spotify-owned playlists, and private playlists require permission from the playlist owner. Please try a user-created playlist or switch to YouTube.',
          });
          return;
        }
        const errText = await plResp.text();
        res.status(plResp.status).json({ error: `Spotify API error: ${errText}` });
        return;
      }

      interface SpotifyTrackEntry {
        is_local?: boolean;
        track?: {
          id?: string;
          name?: string;
          preview_url?: string | null;
          artists?: Array<{ name?: string }>;
          album?: { images?: Array<{ url?: string }> };
        } | null;
      }

      const plJson = (await plResp.json()) as {
        name?: string;
        tracks?: {
          total?: number;
          next?: string | null;
          items?: SpotifyTrackEntry[];
        };
      };

      const allEntries: SpotifyTrackEntry[] = [...(plJson.tracks?.items || [])];
      let nextUrl = plJson.tracks?.next || null;
      let pageGuard = 0;

      while (nextUrl && pageGuard < 2 && allEntries.length < 200) {
        pageGuard++;
        const nextResp = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!nextResp.ok) break;
        const nextJson = (await nextResp.json()) as {
          next?: string | null;
          items?: SpotifyTrackEntry[];
        };
        allEntries.push(...(nextJson.items || []));
        nextUrl = nextJson.next || null;
      }

      const seen = new Set<string>();
      const tracks: TrackItem[] = [];
      for (const entry of allEntries) {
        if (entry.is_local || !entry.track?.id || !entry.track?.name) continue;
        if (seen.has(entry.track.id)) continue;
        seen.add(entry.track.id);
        tracks.push({
          id: `sp_${entry.track.id}`,
          title: entry.track.name,
          artist: (entry.track.artists || []).map((a) => a.name).filter(Boolean).join(', ') || 'Spotify',
          sourceId: entry.track.id,
          sourceType: 'spotify',
          thumbnailUrl: entry.track.album?.images?.[0]?.url,
          previewUrl: entry.track.preview_url || undefined,
        });
      }

      const limitationWarning = hostSession && hostSession.user.product !== 'premium'
        ? 'Your Spotify account is on the Free tier. Spotify Embed Player may play 30-second previews or require signing into open.spotify.com in this browser. YouTube playlists play full tracks without a subscription.'
        : 'Spotify Embed Player is subject to browser autoplay and Spotify session rules. If a track only plays a 30s preview in the embed, ensure you are signed into open.spotify.com in this browser or switch to YouTube.';

      res.json({
        ok: true,
        sourceType: 'spotify',
        playlistId,
        playlistName: plJson.name || 'Spotify Playlist',
        totalFound: tracks.length,
        tracks,
        limitationWarning,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load Spotify playlist.',
      });
    }
  });

  // Server-side ticket generation
  app.post('/api/game/generate-tickets', (req: Request, res: Response) => {
    try {
      const { tracks, playerUids } = req.body as {
        tracks?: TrackItem[];
        playerUids?: string[];
      };

      if (!Array.isArray(tracks) || tracks.length < 15) {
        res.status(400).json({
          error: `At least 15 accessible songs are required to generate tickets (found ${Array.isArray(tracks) ? tracks.length : 0}).`,
        });
        return;
      }
      if (!Array.isArray(playerUids) || playerUids.length === 0) {
        res.status(400).json({ error: 'At least 1 player must join before generating tickets.' });
        return;
      }

      const ticketsByPlayer = generateUniqueTickets(tracks, playerUids);
      const ticketNumbersByPlayer: Record<string, number> = {};
      playerUids.forEach((uid, idx) => {
        ticketNumbersByPlayer[uid] = idx + 1;
      });
      res.json({ ok: true, ticketsByPlayer, ticketNumbersByPlayer });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Ticket generation failed.',
      });
    }
  });

  // Authoritative Server-Side Winner Claim Verification (reads Firestore directly using Host token)
  app.post('/api/game/verify-claim', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Firebase authorization token.' });
        return;
      }
      const idToken = authHeader.slice('Bearer '.length).trim();

      const { roomCode, claimId } = req.body as {
        roomCode?: string;
        claimId?: string;
      };

      if (!roomCode || !/^[A-Z0-9]{6}$/.test(roomCode) || !claimId) {
        res.status(400).json({ error: 'Invalid roomCode or claimId.' });
        return;
      }

      const fbConfig = loadFirebaseConfig();
      if (!fbConfig?.projectId) {
        res.status(500).json({ error: 'Firebase configuration missing on server.' });
        return;
      }

      const result = await withRoomVerificationLock(roomCode, async () => {
        const secretDoc = await fetchFirestoreDocument(
          fbConfig,
          `rooms/${roomCode}/hostState/secret`,
          idToken,
        );
        const claimDoc = await fetchFirestoreDocument(
          fbConfig,
          `rooms/${roomCode}/claims/${claimId}`,
          idToken,
        );

        const playerUid = String(claimDoc.playerUid || '');
        const pattern = claimDoc.pattern as WinningPattern;
        const playerDoc = await fetchFirestoreDocument(
          fbConfig,
          `rooms/${roomCode}/players/${playerUid}`,
          idToken,
        );
        const existingWinnerDoc = await fetchFirestoreDocumentOptional(
          fbConfig,
          `rooms/${roomCode}/winners/${pattern}_${playerUid}`,
          idToken,
        );

        const officialTicket = (playerDoc.ticket as TicketCell[]) || [];
        const ticketNumber = Number(playerDoc.ticketNumber || claimDoc.ticketNumber || 0);
        const claimedSongIds = (claimDoc.claimedSongIds as string[]) || [];
        const officiallyPlayedIds = (secretDoc.playedSongIds as string[]) || [];

        const baseVerification = verifyClaimAgainstPlayedSongs(
          officialTicket,
          claimedSongIds,
          officiallyPlayedIds,
          pattern,
        );

        const prevTs = roomLastProcessedTs.get(roomCode) || 0;
        const serverProcessedAtMs = Math.max(Date.now(), prevTs + 1);
        roomLastProcessedTs.set(roomCode, serverProcessedAtMs);

        const alreadyWonByPlayer = Boolean(existingWinnerDoc);
        const verification = alreadyWonByPlayer
          ? {
              ...baseVerification,
              isValid: false,
              alreadyWonByPlayer: true,
              ticketNumber,
              serverProcessedAtMs,
              summary:
                'Rejected duplicate claim: this player has already won this pattern in this game session.',
            }
          : {
              ...baseVerification,
              alreadyWonByPlayer: false,
              ticketNumber,
              serverProcessedAtMs,
            };

        return { ok: true, verification, officialTicket, ticketNumber, serverProcessedAtMs };
      });

      res.json(result);
    } catch (error) {
      res.status(403).json({
        error:
          error instanceof Error
            ? error.message
            : 'Server verification failed or unauthorized.',
      });
    }
  });

  // Serve Vite in dev or built static dist in production
  const distPath = path.resolve(__dirname, 'dist');
  const isProd =
    process.env.NODE_ENV === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(distPath));
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Musical Housie server listening on port ${PORT}`);
  });
}

startServer();
