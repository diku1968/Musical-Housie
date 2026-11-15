import { AlertTriangle, CheckCircle2, Loader2, Lock, Music2, Youtube } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getCurrentIdToken } from '../services/firebase.ts';
import { extractSpotifyPlaylistId, extractYouTubePlaylistId } from '../shared/gameLogic.ts';
import { PlaylistSourceType, TrackItem } from '../shared/types.ts';
import { resolvePlaylistViaYouTubeIFrame } from './YouTubePlayer.tsx';

interface PlaylistSelectorProps {
  roomCode: string;
  initialSourceType: PlaylistSourceType;
  initialUrl: string;
  initialPlaylistName: string;
  tracks: TrackItem[];
  onPlaylistLoaded: (payload: {
    sourceType: 'youtube' | 'spotify';
    playlistName: string;
    playlistUrl: string;
    tracks: TrackItem[];
  }) => Promise<void>;
}

interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  user: { id: string; displayName: string; product: string } | null;
}

interface YouTubeStatus {
  apiKeyConfigured: boolean;
  oauthConfigured: boolean;
  connected: boolean;
  user: { displayName: string } | null;
}

export function PlaylistSelector({
  roomCode,
  initialSourceType,
  initialUrl,
  initialPlaylistName,
  tracks,
  onPlaylistLoaded,
}: PlaylistSelectorProps) {
  const [tab, setTab] = useState<'youtube' | 'spotify'>(
    initialSourceType === 'spotify' ? 'spotify' : 'youtube',
  );
  const [ytUrl, setYtUrl] = useState(initialSourceType === 'youtube' ? initialUrl : '');
  const [spUrl, setSpUrl] = useState(initialSourceType === 'spotify' ? initialUrl : '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(null);
  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeStatus | null>(null);
  const [requiresSpotifyAuth, setRequiresSpotifyAuth] = useState(false);
  const [requiresYouTubeAuth, setRequiresYouTubeAuth] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<'spotify' | 'youtube' | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getCurrentIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchStatuses = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [spResp, ytResp] = await Promise.all([
        fetch('/api/spotify/status', { headers }),
        fetch('/api/youtube/status', { headers }),
      ]);
      if (spResp.ok) {
        setSpotifyStatus((await spResp.json()) as SpotifyStatus);
      }
      if (ytResp.ok) {
        setYoutubeStatus((await ytResp.json()) as YouTubeStatus);
      }
    } catch {
      // Ignore transient status fetch failure
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchStatuses();

    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SPOTIFY_OAUTH_SUCCESS') {
        setConnectingProvider(null);
        setRequiresSpotifyAuth(false);
        setError('');
        fetchStatuses();
      } else if (event.data?.type === 'SPOTIFY_OAUTH_ERROR') {
        setConnectingProvider(null);
        setError(event.data?.error || 'Spotify authorization failed.');
      } else if (event.data?.type === 'YOUTUBE_OAUTH_SUCCESS') {
        setConnectingProvider(null);
        setRequiresYouTubeAuth(false);
        setError('');
        fetchStatuses();
      } else if (event.data?.type === 'YOUTUBE_OAUTH_ERROR') {
        setConnectingProvider(null);
        setError(event.data?.error || 'YouTube authorization failed.');
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [fetchStatuses]);

  const handleLoadYouTube = async () => {
    setError('');
    setWarning('');
    setRequiresYouTubeAuth(false);

    const trimmedYtUrl = ytUrl.trim();
    const playlistId = extractYouTubePlaylistId(trimmedYtUrl);
    if (!playlistId) {
      const isSingleVideoUrl =
        /^https?:\/\/(youtu\.be\/|(www\.|m\.|music\.)?youtube\.com\/(watch|shorts|live))/i.test(
          trimmedYtUrl,
        );
      setError(
        isSingleVideoUrl
          ? 'That is a single YouTube video link (it has no "?list=" playlist ID). Open a YouTube playlist with at least 15 songs, click Share → Copy link, and paste the playlist URL (e.g., https://www.youtube.com/playlist?list=PL...).'
          : 'Please paste a valid YouTube playlist URL (e.g., https://www.youtube.com/playlist?list=PL...).',
      );
      return;
    }

    setLoading(true);
    try {
      const headers = await authHeaders();
      const resp = await fetch('/api/youtube/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ playlistUrl: ytUrl.trim(), roomCode }),
      });
      const json = (await resp.json()) as {
        ok?: boolean;
        code?: string;
        requiresYouTubeAuth?: boolean;
        oauthConfigured?: boolean;
        playlistName?: string;
        tracks?: TrackItem[];
        skippedRestricted?: number;
        error?: string;
      };

      let resolvedTracks: TrackItem[] = [];
      const playlistName = json.playlistName || 'YouTube Playlist';
      let skipped = json.skippedRestricted || 0;

      if (json.code === 'YOUTUBE_API_KEY_MISSING') {
        const iframeResult = await resolvePlaylistViaYouTubeIFrame(playlistId);
        resolvedTracks = iframeResult.tracks;
        skipped = iframeResult.skippedRestricted;
      } else if (json.requiresYouTubeAuth) {
        setRequiresYouTubeAuth(Boolean(json.oauthConfigured));
        throw new Error(
          json.oauthConfigured
            ? json.error || 'This playlist is private. Connect your Google/YouTube account below to load it.'
            : 'This YouTube playlist is private or restricted. Please change its YouTube visibility to Unlisted or Public and try again.',
        );
      } else if (!resp.ok || !json.tracks) {
        throw new Error(json.error || 'Could not load YouTube playlist.');
      } else {
        resolvedTracks = json.tracks;
      }

      if (skipped > 0) {
        setWarning(
          `${skipped} video(s) could not be embedded or were unavailable and were excluded.`,
        );
      }

      if (resolvedTracks.length < 15) {
        setWarning(
          `Only ${resolvedTracks.length} accessible songs found. At least 15 accessible songs are required to generate tickets.`,
        );
      }

      await onPlaylistLoaded({
        sourceType: 'youtube',
        playlistName,
        playlistUrl: ytUrl.trim(),
        tracks: resolvedTracks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load YouTube playlist.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectYouTube = async () => {
    setError('');
    setConnectingProvider('youtube');
    try {
      const headers = await authHeaders();
      const resp = await fetch('/api/youtube/auth-url', { headers });
      const data = (await resp.json()) as { url?: string; error?: string };
      if (!resp.ok || !data.url) {
        throw new Error(data.error || 'Could not start Google/YouTube authorization.');
      }
      const popup = window.open(data.url, 'youtube_oauth', 'width=560,height=700');
      if (!popup) {
        setConnectingProvider(null);
        setError('Please allow popups for this site to authorize your YouTube account.');
      }
    } catch (err) {
      setConnectingProvider(null);
      setError(err instanceof Error ? err.message : 'YouTube authorization error.');
    }
  };

  const handleDisconnectYouTube = async () => {
    const headers = await authHeaders();
    await fetch('/api/youtube/disconnect', { method: 'POST', headers });
    setRequiresYouTubeAuth(false);
    fetchStatuses();
  };

  const handleConnectSpotify = async () => {
    setError('');
    setConnectingProvider('spotify');
    try {
      const headers = await authHeaders();
      const resp = await fetch('/api/spotify/auth-url', { headers });
      const data = (await resp.json()) as { url?: string; error?: string };
      if (!resp.ok || !data.url) {
        throw new Error(data.error || 'Could not initiate Spotify authorization.');
      }
      const popup = window.open(data.url, 'spotify_oauth', 'width=560,height=700');
      if (!popup) {
        setConnectingProvider(null);
        setError('Please allow popups for this site to connect your Spotify account.');
      }
    } catch (err) {
      setConnectingProvider(null);
      setError(err instanceof Error ? err.message : 'Spotify authorization error.');
    }
  };

  const handleDisconnectSpotify = async () => {
    const headers = await authHeaders();
    await fetch('/api/spotify/disconnect', { method: 'POST', headers });
    setRequiresSpotifyAuth(false);
    fetchStatuses();
  };

  const handleLoadSpotify = async () => {
    setError('');
    setWarning('');
    setRequiresSpotifyAuth(false);

    const playlistId = extractSpotifyPlaylistId(spUrl);
    if (!playlistId) {
      setError(
        'Please paste a valid Spotify playlist URL (e.g., https://open.spotify.com/playlist/...).',
      );
      return;
    }

    setLoading(true);
    try {
      const headers = await authHeaders();
      const resp = await fetch('/api/spotify/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ playlistUrl: spUrl.trim(), roomCode }),
      });
      const json = (await resp.json()) as {
        ok?: boolean;
        requiresSpotifyAuth?: boolean;
        playlistName?: string;
        tracks?: TrackItem[];
        limitationWarning?: string;
        error?: string;
      };

      if (json.requiresSpotifyAuth) {
        setRequiresSpotifyAuth(true);
        throw new Error(
          json.error || 'This playlist is private or restricted. Connect Spotify below to access your private playlists.',
        );
      }

      if (!resp.ok || !json.tracks) {
        throw new Error(json.error || 'Could not retrieve Spotify playlist metadata.');
      }

      if (json.tracks.length < 15) {
        setWarning(
          `Only ${json.tracks.length} accessible tracks found. At least 15 songs are required to generate tickets.`,
        );
      } else if (json.limitationWarning) {
        setWarning(json.limitationWarning);
      }

      await onPlaylistLoaded({
        sourceType: 'spotify',
        playlistName: json.playlistName || 'Spotify Playlist',
        playlistUrl: spUrl.trim(),
        tracks: json.tracks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Spotify playlist.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-white">Select Music Playlist</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Minimum 15 accessible songs required to generate unique 3x5 tickets.
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-[#090D1C] p-1 border border-white/10 self-start">
          <button
            type="button"
            onClick={() => {
              setTab('youtube');
              setError('');
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'youtube'
                ? 'bg-rose-500 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Youtube className="h-4 w-4" />
            <span>YouTube</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('spotify');
              setError('');
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === 'spotify'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Music2 className="h-4 w-4" />
            <span>Spotify</span>
          </button>
        </div>
      </div>

      {tab === 'youtube' ? (
        <div className="space-y-3">
          {youtubeStatus?.connected && (
            <div className="flex items-center justify-between text-xs text-slate-300 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2.5">
              <span>
                YouTube authorized for <strong className="text-white">{youtubeStatus.user?.displayName}</strong>
              </span>
              <button
                type="button"
                onClick={handleDisconnectYouTube}
                className="font-semibold text-slate-300 underline hover:text-white cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          )}

          <label htmlFor="yt-playlist-url" className="block text-sm font-medium text-slate-200">
            YouTube Playlist URL
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              id="yt-playlist-url"
              type="url"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/playlist?list=PL..."
              className="flex-1 rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleLoadYouTube}
              disabled={loading || !ytUrl.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading...</span>
                </>
              ) : (
                <span>Load Playlist</span>
              )}
            </button>
          </div>

          {requiresYouTubeAuth && !youtubeStatus?.connected && youtubeStatus?.oauthConfigured && (
            <div className="rounded-2xl border border-indigo-400/35 bg-indigo-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-slate-200">
                <Lock className="h-4 w-4 text-indigo-300 shrink-0 mt-0.5" />
                <span>
                  This playlist is private. Authorize your Google/YouTube account to read your private playlists.
                </span>
              </div>
              <button
                type="button"
                onClick={handleConnectYouTube}
                disabled={connectingProvider === 'youtube'}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-400 shrink-0 cursor-pointer"
              >
                {connectingProvider === 'youtube' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Authorizing...</span>
                  </>
                ) : (
                  <span>Connect Google / YouTube</span>
                )}
              </button>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Public and unlisted YouTube playlists load automatically. Audio plays via the official YouTube IFrame Player on the host&apos;s device.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {!spotifyStatus?.configured ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 space-y-3">
              <p className="text-sm font-semibold text-amber-200">
                Spotify Playlist Import Unavailable
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                Spotify service credentials are not enabled on this server yet. You can host your game immediately with any YouTube playlist.
              </p>
              <button
                type="button"
                onClick={() => setTab('youtube')}
                className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
              >
                Use YouTube Playlist
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {spotifyStatus.connected && (
                <div className="flex items-center justify-between text-xs text-slate-300 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2.5">
                  <span>
                    Spotify connected as <strong className="text-white">{spotifyStatus.user?.displayName}</strong> ({spotifyStatus.user?.product})
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnectSpotify}
                    className="font-semibold text-slate-300 underline hover:text-white cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              )}

              <label htmlFor="sp-playlist-url" className="block text-sm font-medium text-slate-200">
                Spotify Playlist URL
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  id="sp-playlist-url"
                  type="url"
                  value={spUrl}
                  onChange={(e) => setSpUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/..."
                  className="flex-1 rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleLoadSpotify}
                  disabled={loading || !spUrl.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <span>Load Playlist</span>
                  )}
                </button>
              </div>

              {!spotifyStatus.connected && (
                <div
                  className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    requiresSpotifyAuth
                      ? 'border-emerald-400/45 bg-emerald-500/15'
                      : 'border-white/10 bg-[#090D1C]'
                  }`}
                >
                  <div className="text-xs text-slate-300">
                    {requiresSpotifyAuth
                      ? 'This playlist requires your Spotify account permission to read.'
                      : 'Public user playlists load automatically. Connect Spotify only if you want to use a private playlist.'}
                  </div>
                  <button
                    type="button"
                    onClick={handleConnectSpotify}
                    disabled={connectingProvider === 'spotify'}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60 shrink-0 cursor-pointer"
                  >
                    {connectingProvider === 'spotify' ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Waiting for Spotify...</span>
                      </>
                    ) : (
                      <>
                        <Music2 className="h-3.5 w-3.5" />
                        <span>Connect Spotify</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-rose-300 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>{error}</p>
            {tab === 'spotify' && (
              <button
                type="button"
                onClick={() => {
                  setTab('youtube');
                  setError('');
                }}
                className="text-xs font-semibold text-amber-300 underline cursor-pointer"
              >
                Switch to YouTube Playlist
              </button>
            )}
          </div>
        </div>
      )}

      {warning && (
        <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      {tracks.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#090D1C] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${
                  tracks.length >= 15 ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
              <span className="text-sm font-semibold text-white">
                {initialPlaylistName || 'Loaded Playlist'}
              </span>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-300">
              {tracks.length} accessible songs
            </span>
          </div>

          <div className="max-h-44 overflow-y-auto divide-y divide-white/5 pr-1">
            {tracks.map((track, idx) => (
              <div key={track.id} className="py-1.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono tabular-nums text-slate-500 w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <span className="text-slate-200 truncate">{track.title}</span>
                </div>
                <span className="text-slate-400 truncate max-w-[140px] shrink-0">
                  {track.artist}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
