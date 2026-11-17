import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractFirstUrlFromInput,
  extractYouTubePlaylistId,
  generateUniqueTickets,
  normalizeYouTubePlaylistUrl,
  verifyClaimAgainstPlayedSongs,
} from './src/shared/gameLogic.ts';
import type { ProblemTrackItem, TicketCell, TrackItem, WinningPattern } from './src/shared/types.ts';

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

const tokenUidCache = new Map<string, { uid: string; expiresAt: number }>();

function cleanExpiredTokenCache() {
  const now = Date.now();
  for (const [hash, cached] of tokenUidCache.entries()) {
    if (cached.expiresAt <= now) {
      tokenUidCache.delete(hash);
    }
  }
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

    cleanExpiredTokenCache();
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
    });
  });

  const YOUTUBE_SCRAPE_HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: 'SOCS=CAI',
  };

  function extractJsonObjectAfterPrefix(html: string, prefixRegex: RegExp): Record<string, unknown> | null {
    const match = prefixRegex.exec(html);
    if (!match) return null;
    const startIdx = match.index + match[0].length - 1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIdx; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(startIdx, i + 1)) as Record<string, unknown>;
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  function decodeXmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  async function resolveYouTubePlaylistIdWithRedirects(rawInput: string): Promise<string | null> {
    const directId = extractYouTubePlaylistId(rawInput);
    if (directId) return directId;

    const candidateUrl = extractFirstUrlFromInput(rawInput);
    if (!candidateUrl) return null;

    try {
      const parsed = new URL(candidateUrl);
      const allowedHosts = ['youtube.com', 'youtu.be', 'yt.be', 'goo.gl'];
      const isAllowed = allowedHosts.some(
        (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
      );
      if (!isAllowed) return null;

      const resp = await fetch(candidateUrl, {
        headers: YOUTUBE_SCRAPE_HEADERS,
        redirect: 'follow',
      });
      const resolvedFromFinalUrl = extractYouTubePlaylistId(resp.url);
      if (resolvedFromFinalUrl) return resolvedFromFinalUrl;

      const body = await resp.text();
      const canonicalMatch = body.match(
        /<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
      );
      if (canonicalMatch?.[1]) {
        const fromCanonical = extractYouTubePlaylistId(canonicalMatch[1]);
        if (fromCanonical) return fromCanonical;
      }
      const ogUrlMatch = body.match(
        /<meta\s+property=["']og:url["'][^>]*content=["']([^"']+)["']/i,
      );
      if (ogUrlMatch?.[1]) {
        const fromOg = extractYouTubePlaylistId(ogUrlMatch[1]);
        if (fromOg) return fromOg;
      }
    } catch {
      // Ignore redirect resolution failure
    }
    return null;
  }

  async function checkYouTubeVideoEmbeddable(
    videoId: string,
  ): Promise<{ embeddable: boolean; reason?: string }> {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
      const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(2500) });
      if (resp.ok) {
        return { embeddable: true };
      }
      if (resp.status === 401 || resp.status === 403) {
        return {
          embeddable: false,
          reason: 'Embedding disabled by video owner (cannot play in web player)',
        };
      }
      if (resp.status === 404 || resp.status === 400) {
        return {
          embeddable: false,
          reason: 'Video is private, deleted, or unavailable',
        };
      }
      // Transient 429/5xx -> don't wrongly exclude playable tracks
      return { embeddable: true };
    } catch {
      return { embeddable: true };
    }
  }

  async function resolvePublicYouTubePlaylistFromWeb(playlistId: string): Promise<{
    playlistName: string;
    tracks: TrackItem[];
    problemTracks: ProblemTrackItem[];
    isPrivateOrUnavailable: boolean;
  }> {
    let playlistName = 'YouTube Playlist';
    let isPrivateOrUnavailable = false;
    const candidateTracks: Array<TrackItem & { position: number }> = [];
    const problemTracks: ProblemTrackItem[] = [];
    const seenIds = new Set<string>();
    const seenProblemKeys = new Set<string>();
    let discoveredOrder = 0;

    const addProblemTrack = (item: ProblemTrackItem) => {
      const key = item.sourceId || `${item.position ?? 0}:${item.title}`;
      if (seenProblemKeys.has(key)) return;
      seenProblemKeys.add(key);
      problemTracks.push(item);
    };

    const addTrack = (videoId: string, title: string, artist: string, thumbnailUrl?: string) => {
      const cleanTitle = title.trim();
      const isUnavailablePlaceholder =
        !cleanTitle ||
        cleanTitle === 'Private video' ||
        cleanTitle === 'Deleted video' ||
        cleanTitle === '[Private video]' ||
        cleanTitle === '[Deleted video]';

      if (isUnavailablePlaceholder) {
        discoveredOrder++;
        addProblemTrack({
          position: discoveredOrder,
          sourceId: /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : '',
          title: cleanTitle || 'Unavailable Video',
          artist: artist.trim() || 'YouTube',
          reason: 'Private or deleted video in YouTube playlist',
        });
        return;
      }

      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId) || seenIds.has(videoId)) return;
      seenIds.add(videoId);
      discoveredOrder++;
      candidateTracks.push({
        position: discoveredOrder,
        id: `yt_${videoId}`,
        title: cleanTitle,
        artist: (artist.trim() || 'YouTube').replace(/\s*-\s*Topic$/, ''),
        sourceId: videoId,
        sourceType: 'youtube',
        thumbnailUrl: thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      });
    };

    try {
      const resp = await fetch(
        `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
        { headers: YOUTUBE_SCRAPE_HEADERS },
      );
      if (resp.ok) {
        const html = await resp.text();
        const data = extractJsonObjectAfterPrefix(html, /(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*\{/);

        if (data) {
          const metaTitle = (
            (data.metadata as { playlistMetadataRenderer?: { title?: string } })
              ?.playlistMetadataRenderer?.title ||
            (data.header as { playlistHeaderRenderer?: { title?: { simpleText?: string } } })
              ?.playlistHeaderRenderer?.title?.simpleText ||
            ''
          ).trim();
          if (metaTitle) playlistName = metaTitle;

          const alerts = data.alerts as Array<{
            alertRenderer?: { text?: { simpleText?: string; runs?: Array<{ text?: string }> } };
          }> | undefined;
          if (Array.isArray(alerts)) {
            const alertText = alerts
              .map(
                (a) =>
                  a.alertRenderer?.text?.simpleText ||
                  a.alertRenderer?.text?.runs?.map((r) => r.text || '').join('') ||
                  '',
              )
              .join(' ')
              .toLowerCase();
            if (
              alertText.includes('does not exist') ||
              alertText.includes('private') ||
              alertText.includes('not viewable')
            ) {
              isPrivateOrUnavailable = true;
            }
          }

          const visit = (node: unknown) => {
            if (!node || typeof node !== 'object' || candidateTracks.length >= 200) return;
            if (Array.isArray(node)) {
              for (const item of node) visit(item);
              return;
            }
            const obj = node as Record<string, unknown>;

            if (obj.playlistVideoRenderer && typeof obj.playlistVideoRenderer === 'object') {
              const pvr = obj.playlistVideoRenderer as {
                videoId?: string;
                title?: { simpleText?: string; runs?: Array<{ text?: string }> };
                shortBylineText?: { runs?: Array<{ text?: string }> };
                longBylineText?: { runs?: Array<{ text?: string }> };
                thumbnail?: { thumbnails?: Array<{ url?: string }> };
              };
              const vid = pvr.videoId || '';
              const title =
                pvr.title?.runs?.map((r) => r.text || '').join('') ||
                pvr.title?.simpleText ||
                '';
              const artist =
                pvr.shortBylineText?.runs?.[0]?.text ||
                pvr.longBylineText?.runs?.[0]?.text ||
                'YouTube';
              const thumb = pvr.thumbnail?.thumbnails?.[0]?.url;
              addTrack(vid, title, artist, thumb);
            }

            if (obj.lockupViewModel && typeof obj.lockupViewModel === 'object') {
              const lvm = obj.lockupViewModel as {
                contentId?: string;
                contentType?: string;
                metadata?: {
                  lockupMetadataViewModel?: {
                    title?: { content?: string };
                    metadata?: {
                      contentMetadataViewModel?: {
                        metadataRows?: Array<{
                          metadataParts?: Array<{ text?: { content?: string } }>;
                        }>;
                      };
                    };
                  };
                };
                contentImage?: {
                  thumbnailViewModel?: {
                    image?: { sources?: Array<{ url?: string }> };
                  };
                };
              };
              const vid = lvm.contentId || '';
              const lm = lvm.metadata?.lockupMetadataViewModel;
              const title = lm?.title?.content || '';
              const artist =
                lm?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]
                  ?.text?.content || 'YouTube';
              const thumb = lvm.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url;
              if (title) {
                addTrack(vid, title, artist, thumb);
              }
            }

            for (const val of Object.values(obj)) {
              if (val && typeof val === 'object') visit(val);
            }
          };

          visit(data.contents || data);
        } else {
          const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
          if (titleTag) {
            const clean = decodeXmlEntities(titleTag).replace(/\s*-\s*YouTube$/i, '').trim();
            if (clean && clean.toLowerCase() !== 'youtube') playlistName = clean;
          }
        }
      }
    } catch {
      // Fall through to RSS fallback
    }

    if (candidateTracks.length === 0) {
      try {
        const rssResp = await fetch(
          `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`,
          { headers: YOUTUBE_SCRAPE_HEADERS },
        );
        if (rssResp.ok) {
          const xml = await rssResp.text();
          const feedTitle = xml.match(/<feed[\s\S]*?<title>([^<]+)<\/title>/)?.[1];
          if (feedTitle) playlistName = decodeXmlEntities(feedTitle);

          const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
          for (const entryMatch of entryMatches) {
            const entry = entryMatch[1];
            const vid = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1]?.trim() || '';
            const title = decodeXmlEntities(entry.match(/<title>([^<]+)<\/title>/)?.[1] || '');
            const artist = decodeXmlEntities(
              entry.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1] || 'YouTube',
            );
            addTrack(vid, title, artist);
          }
        }
      } catch {
        // Ignore RSS fallback failure
      }
    }

    // Verify embeddability of each track via fast batched YouTube oEmbed checks
    const tracks: TrackItem[] = [];
    for (let i = 0; i < candidateTracks.length; i += 20) {
      const batch = candidateTracks.slice(i, i + 20);
      const checks = await Promise.all(
        batch.map(async (item) => {
          const check = await checkYouTubeVideoEmbeddable(item.sourceId);
          return { item, check };
        }),
      );
      for (const { item, check } of checks) {
        if (check.embeddable) {
          const { position: _pos, ...cleanTrack } = item;
          tracks.push(cleanTrack);
        } else {
          addProblemTrack({
            position: item.position,
            sourceId: item.sourceId,
            title: item.title,
            artist: item.artist,
            reason: check.reason || 'Video cannot be embedded in player',
          });
        }
      }
    }

    problemTracks.sort((a, b) => (a.position || 9999) - (b.position || 9999));

    return { playlistName, tracks, problemTracks, isPrivateOrUnavailable };
  }

  // Official YouTube Data API v3 playlist loader + direct web/RSS public playlist loader
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

      const playlistId = await resolveYouTubePlaylistIdWithRedirects(playlistUrl);
      if (!playlistId) {
        const isSingleVideoUrl =
          /(youtu\.be\/|(www\.|m\.|music\.)?youtube\.com\/(watch|shorts|live))/i.test(
            playlistUrl,
          );
        res.status(400).json({
          error: isSingleVideoUrl
            ? 'That looks like a single YouTube video link without a playlist ("list="). In the YouTube app, open your Playlist page, tap Share → Copy link, and paste it here.'
            : 'Invalid YouTube playlist URL. Make sure the link contains a "?list=" playlist ID (e.g., https://youtube.com/playlist?list=PL...).',
        });
        return;
      }

      if (playlistId === 'WL' || playlistId === 'LL') {
        res.status(400).json({
          error:
            'Watch Later and Liked Videos are private to your account. Please create or share a Public or Unlisted playlist link instead.',
        });
        return;
      }

      const canonicalUrl = normalizeYouTubePlaylistUrl(playlistId);
      const webResolved = await resolvePublicYouTubePlaylistFromWeb(playlistId);

      if (webResolved.tracks.length > 0 || webResolved.problemTracks.length > 0) {
        if (webResolved.tracks.length > 0) {
          res.json({
            ok: true,
            sourceType: 'youtube',
            playlistId,
            canonicalUrl,
            playlistName: webResolved.playlistName,
            totalFound: webResolved.tracks.length,
            skippedRestricted: webResolved.problemTracks.length,
            tracks: webResolved.tracks,
            problemTracks: webResolved.problemTracks,
          });
          return;
        }
      }

      if (webResolved.isPrivateOrUnavailable) {
        res.status(400).json({
          ok: false,
          code: 'PLAYLIST_UNAVAILABLE',
          playlistId,
          canonicalUrl,
          error:
            'This YouTube playlist is Private or unavailable. In the YouTube app, set your playlist visibility to Public or Unlisted and try again.',
        });
        return;
      }

      if (webResolved.problemTracks.length > 0) {
        res.status(400).json({
          ok: false,
          code: 'ALL_TRACKS_UNPLAYABLE',
          playlistId,
          canonicalUrl,
          problemTracks: webResolved.problemTracks,
          error:
            'All videos found in this playlist are private, deleted, or have embedding disabled by the uploader. Please check the problem videos listed below.',
        });
        return;
      }

      res.json({
        ok: false,
        code: 'YOUTUBE_IFRAME_FALLBACK',
        playlistId,
        canonicalUrl,
        playlistName: webResolved.playlistName,
        message: 'Falling back to official YouTube IFrame Player + oEmbed loader.',
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
      const problemTracks: ProblemTrackItem[] = [];

      const fetchFallbackWatchTitle = async (videoId: string): Promise<string> => {
        try {
          const watchResp = await fetch(
            `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            { headers: YOUTUBE_SCRAPE_HEADERS, signal: AbortSignal.timeout(2000) },
          );
          if (!watchResp.ok) return '';
          const html = await watchResp.text();
          const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
          if (!titleTag) return '';
          const clean = decodeXmlEntities(titleTag).replace(/\s*-\s*YouTube$/i, '').trim();
          return clean && clean.toLowerCase() !== 'youtube' ? clean : '';
        } catch {
          return '';
        }
      };

      for (let i = 0; i < uniqueIds.length; i += 10) {
        const batch = uniqueIds.slice(i, i + 10);
        const results = await Promise.all(
          batch.map(async (videoId, batchIdx) => {
            const position = i + batchIdx + 1;
            try {
              const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
              const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(2500) });
              if (!resp.ok) {
                const reason =
                  resp.status === 401 || resp.status === 403
                    ? 'Embedding disabled by video owner (cannot play in web player)'
                    : 'Video is private, deleted, or unavailable';
                const title = (await fetchFallbackWatchTitle(videoId)) || `Unavailable Video (${videoId})`;
                return {
                  track: null,
                  problem: { position, sourceId: videoId, title, reason } satisfies ProblemTrackItem,
                };
              }
              const data = (await resp.json()) as {
                title?: string;
                author_name?: string;
                thumbnail_url?: string;
              };
              if (!data.title) {
                return {
                  track: null,
                  problem: {
                    position,
                    sourceId: videoId,
                    title: `Video ${videoId}`,
                    reason: 'Missing video title metadata',
                  } satisfies ProblemTrackItem,
                };
              }
              return {
                track: {
                  id: `yt_${videoId}`,
                  title: data.title,
                  artist: (data.author_name || 'YouTube').replace(/\s*-\s*Topic$/, ''),
                  sourceId: videoId,
                  sourceType: 'youtube' as const,
                  thumbnailUrl: data.thumbnail_url,
                },
                problem: null,
              };
            } catch {
              return {
                track: null,
                problem: {
                  position,
                  sourceId: videoId,
                  title: `Video ${videoId}`,
                  reason: 'Could not load video metadata from YouTube',
                } satisfies ProblemTrackItem,
              };
            }
          }),
        );

        for (const item of results) {
          if (item.track) {
            tracks.push(item.track);
          } else if (item.problem) {
            problemTracks.push(item.problem);
          }
        }
      }

      res.json({
        ok: true,
        tracks,
        problemTracks,
        skippedRestricted: problemTracks.length,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to resolve YouTube metadata.',
      });
    }
  });

  // Spotify integration removed by host preference; YouTube playlists only.

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
  const publicPath = path.resolve(__dirname, 'public');
  const isProd =
    process.env.NODE_ENV === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(distPath));

  const resolveStaticCrawlerFile = (filename: string): string | null => {
    const candidates = isProd
      ? [path.join(distPath, filename), path.join(publicPath, filename)]
      : [path.join(publicPath, filename), path.join(distPath, filename)];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  app.get('/ads.txt', (_req: Request, res: Response) => {
    const filePath = resolveStaticCrawlerFile('ads.txt');
    if (!filePath) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(filePath);
  });

  app.get('/robots.txt', (_req: Request, res: Response) => {
    const filePath = resolveStaticCrawlerFile('robots.txt');
    if (!filePath) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(filePath);
  });

  app.get('/sitemap.xml', (_req: Request, res: Response) => {
    const filePath = resolveStaticCrawlerFile('sitemap.xml');
    if (!filePath) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.sendFile(filePath);
  });

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
