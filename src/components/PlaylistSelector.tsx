import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Trash2, Youtube } from 'lucide-react';
import { useCallback, useState } from 'react';
import { getCurrentIdToken } from '../services/firebase.ts';
import {
  extractFirstUrlFromInput,
  extractYouTubePlaylistId,
  normalizeYouTubePlaylistUrl,
} from '../shared/gameLogic.ts';
import { PlaylistSourceType, ProblemTrackItem, TrackItem } from '../shared/types.ts';
import { resolvePlaylistViaYouTubeIFrame } from './YouTubePlayer.tsx';

interface PlaylistSelectorProps {
  roomCode: string;
  initialSourceType: PlaylistSourceType;
  initialUrl: string;
  initialPlaylistName: string;
  tracks: TrackItem[];
  onPlaylistLoaded: (payload: {
    sourceType: 'youtube';
    playlistName: string;
    playlistUrl: string;
    tracks: TrackItem[];
  }) => Promise<void>;
}

export function PlaylistSelector({
  roomCode,
  initialSourceType,
  initialUrl,
  initialPlaylistName,
  tracks,
  onPlaylistLoaded,
}: PlaylistSelectorProps) {
  const [ytUrl, setYtUrl] = useState(initialSourceType === 'youtube' ? initialUrl : '');

  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [problemTracks, setProblemTracks] = useState<ProblemTrackItem[]>([]);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getCurrentIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const handleLoadYouTube = async () => {
    setError('');
    setWarning('');
    setProblemTracks([]);

    const rawInput = ytUrl.trim();
    const localPlaylistId = extractYouTubePlaylistId(rawInput);
    const extractedUrl = extractFirstUrlFromInput(rawInput);

    if (!localPlaylistId && !extractedUrl) {
      setError(
        'Please paste a valid YouTube playlist URL (e.g., https://youtube.com/playlist?list=PL...).',
      );
      return;
    }

    setLoading(true);
    try {
      let resolvedTracks: TrackItem[] = [];
      let detectedProblems: ProblemTrackItem[] = [];
      let playlistName = 'YouTube Playlist';
      let skipped = 0;
      const resolvedPlaylistId = localPlaylistId || '';

      if (!resolvedPlaylistId) {
        throw new Error('Please enter a valid YouTube Playlist URL containing a list ID (list=...).');
      }

      // Bypass backend server directly on GitHub Pages using client-side IFrame
      const iframeResult = await resolvePlaylistViaYouTubeIFrame(resolvedPlaylistId);
      
      if (!iframeResult.tracks || iframeResult.tracks.length === 0) {
        throw new Error('Could not load songs from this playlist. Ensure the playlist is Public or Unlisted.');
      }

      resolvedTracks = iframeResult.tracks;
      detectedProblems = iframeResult.problemTracks || [];
      skipped = iframeResult.skippedRestricted || detectedProblems.length;

      const canonicalPlaylistUrl = normalizeYouTubePlaylistUrl(resolvedPlaylistId);

      setProblemTracks(detectedProblems);

      if (skipped > 0) {
        setWarning(
          `${skipped} problem video(s) cannot be played in the app and were excluded.`,
        );
      }

      if (resolvedTracks.length < 15) {
        setWarning(
          `Only ${resolvedTracks.length} playable songs found. At least 15 playable songs are required to generate tickets.`,
        );
      }

      setYtUrl(canonicalPlaylistUrl);

      await onPlaylistLoaded({
        sourceType: 'youtube',
        playlistName,
        playlistUrl: canonicalPlaylistUrl,
        tracks: resolvedTracks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load YouTube playlist.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTrack = async (trackId: string) => {
    setError('');
    setRemovingId(trackId);
    try {
      const nextTracks = tracks.filter((t) => t.id !== trackId);
      await onPlaylistLoaded({
        sourceType: 'youtube',
        playlistName: initialPlaylistName || 'YouTube Playlist',
        playlistUrl: initialUrl || ytUrl.trim(),
        tracks: nextTracks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove song.');
    } finally {
      setRemovingId('');
    }
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-white">Select YouTube Playlist</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Minimum 15 playable songs required to generate unique 3x5 tickets.
          </p>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl bg-rose-500/15 border border-rose-400/30 px-3.5 py-2 text-xs font-semibold text-rose-200 self-start">
          <Youtube className="h-4 w-4 text-rose-400" />
          <span>YouTube</span>
        </div>
      </div>

      <div className="space-y-3">
        <label htmlFor="yt-playlist-url" className="block text-sm font-medium text-slate-200">
          YouTube Playlist Link (Desktop or Mobile App)
        </label>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            id="yt-playlist-url"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            placeholder="Paste link from YouTube app (e.g., https://youtube.com/playlist?list=PL...)"
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
                <span>Checking & Loading...</span>
              </>
            ) : (
              <span>Load Playlist</span>
            )}
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Works with Public or Unlisted YouTube playlists from both mobile and desktop. In the YouTube app, open your playlist → tap Share → Copy link.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-rose-300 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {warning && (
        <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      {problemTracks.length > 0 && (
        <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-rose-200">
              <AlertTriangle className="h-4 w-4 text-rose-300 shrink-0" />
              <span className="text-sm font-bold">
                Problem Songs Found ({problemTracks.length})
              </span>
            </div>
            {(initialUrl || ytUrl.trim()) && (
              <a
                href={initialUrl || extractFirstUrlFromInput(ytUrl) || ytUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-rose-300/35 bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/30"
              >
                <span>Open Playlist on YouTube</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <p className="text-xs text-rose-100/90">
            These songs were automatically excluded because YouTube will not play them here.
          </p>
          <div className="max-h-48 overflow-y-auto divide-y divide-rose-300/15 pr-1">
            {problemTracks.map((item, idx) => (
              <div
                key={`${item.sourceId || 'missing'}-${item.position ?? idx}`}
                className="py-2 flex items-start justify-between gap-3 text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="font-semibold text-white truncate">
                    {item.position ? `#${item.position} · ` : ''}
                    {item.title}
                  </div>
                  <div className="text-[11px] text-rose-200/90">
                    {item.artist ? `${item.artist} · ` : ''}
                    {item.reason}
                  </div>
                </div>
                {item.sourceId && (
                  <a
                    href={`https://www.youtube.com/watch?v=${encodeURIComponent(item.sourceId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10 shrink-0"
                  >
                    <span>YouTube</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
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
              {tracks.length} playable songs
            </span>
          </div>

          <div className="max-h-52 overflow-y-auto divide-y divide-white/5 pr-1">
            {tracks.map((track, idx) => (
              <div key={track.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="font-mono tabular-nums text-slate-500 w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <span className="text-slate-200 truncate">{track.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 truncate max-w-[110px] hidden sm:inline">
                    {track.artist}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTrack(track.id)}
                    disabled={removingId === track.id}
                    title="Remove song from this room playlist"
                    aria-label={`Remove ${track.title}`}
                    className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
