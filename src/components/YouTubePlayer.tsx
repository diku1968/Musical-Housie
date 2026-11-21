import { useEffect, useRef, useState } from 'react';
import { ProblemTrackItem, TrackItem } from '../shared/types.ts';

interface YTPlayerInstance {
  loadVideoById: (videoId: string) => void;
  cueVideoById: (videoId: string) => void;
  cuePlaylist: (opts: { listType: string; list: string; index?: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getPlaylist: () => string[] | null;
  getPlayerState: () => number;
  getCurrentTime?: () => number;
  getVideoData?: () => { video_id?: string; title?: string };
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          height?: string;
          width?: string;
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
            onError?: (event: { data: number }) => void;
          };
        },
      ) => YTPlayerInstance;
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

export function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const existingScript = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve();
    };
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    } else {
      const timer = window.setInterval(() => {
        if (window.YT && window.YT.Player) {
          window.clearInterval(timer);
          resolve();
        }
      }, 150);
    }
  });

  return ytApiPromise;
}

// Client-side validator: Checks both Noembed and YouTube oEmbed to detect playback restrictions
async function checkAndFetchVideoMeta(videoId: string): Promise<{
  title: string;
  author: string;
  isPlayable: boolean;
  reason?: string;
}> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.error) {
        return {
          title: `Video ID ${videoId}`,
          author: 'YouTube',
          isPlayable: false,
          reason: 'Embedding restricted by copyright owner (Error 150/101)',
        };
      }
      if (data.title) {
        return {
          title: data.title,
          author: data.author_name || 'YouTube Music',
          isPlayable: true,
        };
      }
    }
  } catch {
    // If network fails
  }

  return {
    title: `Video ID ${videoId}`,
    author: 'YouTube',
    isPlayable: false,
    reason: 'Could not verify playback permissions',
  };
}

export async function resolvePlaylistViaYouTubeIFrame(playlistId: string): Promise<{
  tracks: TrackItem[];
  skippedRestricted: number;
  problemTracks: ProblemTrackItem[];
}> {
  await loadYouTubeIframeApi();

  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'fixed';
  tempContainer.style.bottom = '0';
  tempContainer.style.right = '0';
  tempContainer.style.width = '200px';
  tempContainer.style.height = '120px';
  tempContainer.style.opacity = '0.01';
  tempContainer.style.pointerEvents = 'none';
  tempContainer.style.zIndex = '-1';
  document.body.appendChild(tempContainer);

  const playerMount = document.createElement('div');
  tempContainer.appendChild(playerMount);

  let player: YTPlayerInstance | null = null;
  let pollTimer: number | undefined;
  let cueFallbackTimer: number | undefined;

  try {
    const videoIds = await new Promise<string[]>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          if (pollTimer !== undefined) window.clearInterval(pollTimer);
          if (cueFallbackTimer !== undefined) window.clearTimeout(cueFallbackTimer);
          reject(
            new Error(
              'Timed out loading YouTube playlist. Ensure the playlist is Public or Unlisted.',
            ),
          );
        }
      }, 14000);

      player = new window.YT!.Player(playerMount, {
        height: '120',
        width: '200',
        playerVars: {
          listType: 'playlist',
          list: playlistId,
          autoplay: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            cueFallbackTimer = window.setTimeout(() => {
              if (!settled) {
                try {
                  event.target.cuePlaylist({ listType: 'playlist', list: playlistId });
                } catch {
                  // Ignore cue retry error
                }
              }
            }, 1800);
            pollTimer = window.setInterval(() => {
              const list = event.target.getPlaylist();
              if (Array.isArray(list) && list.length > 0 && !settled) {
                settled = true;
                if (pollTimer !== undefined) window.clearInterval(pollTimer);
                if (cueFallbackTimer !== undefined) window.clearTimeout(cueFallbackTimer);
                window.clearTimeout(timeout);
                resolve(list);
              }
            }, 250);
          },
          onError: () => {
            if (!settled) {
              settled = true;
              if (pollTimer !== undefined) window.clearInterval(pollTimer);
              if (cueFallbackTimer !== undefined) window.clearTimeout(cueFallbackTimer);
              window.clearTimeout(timeout);
              reject(
                new Error(
                  'YouTube could not load this playlist. Make sure the playlist is Public or Unlisted and contains embeddable videos.',
                ),
              );
            }
          },
        },
      });
    });

    const tracks: TrackItem[] = [];
    const problemTracks: ProblemTrackItem[] = [];
    const uniqueIds = Array.from(new Set(videoIds)).slice(0, 100);

    for (let i = 0; i < uniqueIds.length; i++) {
      const vid = uniqueIds[i];
      const meta = await checkAndFetchVideoMeta(vid);

      if (!meta.isPlayable) {
        problemTracks.push({
          position: i + 1,
          sourceId: vid,
          title: meta.title,
          artist: meta.author,
          reason: meta.reason || 'Embedding disabled by copyright owner',
        });
      } else {
        tracks.push({
          id: `yt_${vid}`,
          title: meta.title.slice(0, 120),
          artist: meta.author.slice(0, 80),
          sourceType: 'youtube',
          sourceId: vid,
          thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        });
      }
    }

    return {
      tracks,
      skippedRestricted: problemTracks.length,
      problemTracks,
    };
  } finally {
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    try {
      if (player) (player as YTPlayerInstance).destroy();
    } catch {
      // Ignore cleanup
    }
    tempContainer.remove();
  }
}

export interface PlaybackProgressInfo {
  songElapsedSeconds: number;
  isAdPlaying: boolean;
  playerPlaying: boolean;
}

interface YouTubePlayerProps {
  videoId: string;
  isPlaying: boolean;
  playSignal?: number;
  stopSignal?: number;
  clipDurationSeconds?: number | null;
  onTrackEnded?: () => void;
  onAutoStop?: () => void;
  onPlaybackError?: (message: string, errorCode?: number) => void;
  onStateSync?: (playing: boolean) => void;
  onPlaybackProgress?: (info: PlaybackProgressInfo) => void;
  caption?: string;
}

export function YouTubePlayer({
  videoId,
  isPlaying,
  playSignal = 0,
  stopSignal = 0,
  clipDurationSeconds = null,
  onTrackEnded,
  onAutoStop,
  onPlaybackError,
  onStateSync,
  onPlaybackProgress,
  caption,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const loadedVideoRef = useRef<string>('');
  const lastPlaySignalRef = useRef<number>(playSignal);
  const lastStopSignalRef = useRef<number>(stopSignal);
  const programmaticUntilRef = useRef<number>(0);
  const songElapsedMsRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const autoStoppedRef = useRef<boolean>(false);
  const [ready, setReady] = useState(false);

  const callbacksRef = useRef({
    onTrackEnded,
    onAutoStop,
    onPlaybackError,
    onStateSync,
    onPlaybackProgress,
  });
  callbacksRef.current = {
    onTrackEnded,
    onAutoStop,
    onPlaybackError,
    onStateSync,
    onPlaybackProgress,
  };

  const statePropsRef = useRef({ videoId, clipDurationSeconds });
  statePropsRef.current = { videoId, clipDurationSeconds };

  useEffect(() => {
    let active = true;

    loadYouTubeIframeApi().then(() => {
      if (!active || !containerRef.current || !window.YT?.Player) return;

      const mount = document.createElement('div');
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mount);

      const player = new window.YT.Player(mount, {
        width: '100%',
        height: '220',
        videoId: videoId || undefined,
        playerVars: {
          autoplay: isPlaying ? 1 : 0,
          controls: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            if (!active) return;
            playerRef.current = player;
            loadedVideoRef.current = videoId;
            setReady(true);
            if (videoId && isPlaying) {
              programmaticUntilRef.current = Date.now() + 700;
              player.playVideo();
            }
          },
          onStateChange: (event) => {
            if (!active) return;
            if (event.data === 0) {
              callbacksRef.current.onTrackEnded?.();
            } else if (event.data === 1) {
              if (Date.now() > programmaticUntilRef.current) {
                callbacksRef.current.onStateSync?.(true);
              }
            } else if (event.data === 2) {
              if (Date.now() > programmaticUntilRef.current) {
                callbacksRef.current.onStateSync?.(false);
              }
            }
          },
          onError: (event) => {
            if (!active) return;
            const code = event.data;
            const msg =
              code === 101 || code === 150
                ? 'Embedding disabled by uploader/copyright owner (Error 101/150).'
                : code === 100
                  ? 'Video was removed or set to private on YouTube (Error 100).'
                  : `YouTube player could not play this video (Error ${code}).`;
            callbacksRef.current.onPlaybackError?.(msg, code);
          },
        },
      });
    });

    return () => {
      active = false;
      try {
        playerRef.current?.destroy();
      } catch {
        // Ignore
      }
      playerRef.current = null;
    };
  }, [videoId, isPlaying]);

  useEffect(() => {
    if (!ready) return;
    lastTickRef.current = Date.now();

    const interval = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.min(1000, Math.max(0, now - lastTickRef.current));
      lastTickRef.current = now;

      const player = playerRef.current;
      if (!player) return;

      let playerState = -1;
      try {
        playerState = player.getPlayerState();
      } catch {
        return;
      }

      const { videoId: targetVid, clipDurationSeconds: clipLimit } = statePropsRef.current;
      const currentLoadedVid = player.getVideoData?.()?.video_id;
      const isAdPlaying =
        (playerState === 1 || playerState === 3) &&
        Boolean(currentLoadedVid) &&
        Boolean(targetVid) &&
        currentLoadedVid !== targetVid;

      const playerPlaying = playerState === 1;

      if (playerPlaying && !isAdPlaying) {
        songElapsedMsRef.current += dt;
      }

      const elapsedSeconds = Math.floor(songElapsedMsRef.current / 1000);
      callbacksRef.current.onPlaybackProgress?.({
        songElapsedSeconds: elapsedSeconds,
        isAdPlaying,
        playerPlaying,
      });

      if (
        clipLimit &&
        clipLimit > 0 &&
        playerPlaying &&
        !isAdPlaying &&
        elapsedSeconds >= clipLimit &&
        !autoStoppedRef.current
      ) {
        autoStoppedRef.current = true;
        programmaticUntilRef.current = Date.now() + 800;
        try {
          player.pauseVideo();
        } catch {
          // Ignore
        }
        callbacksRef.current.onAutoStop?.();
      }
    }, 350);

    return () => window.clearInterval(interval);
  }, [ready]);

  useEffect(() => {
    if (!clipDurationSeconds || Math.floor(songElapsedMsRef.current / 1000) < clipDurationSeconds) {
      autoStoppedRef.current = false;
    }
  }, [clipDurationSeconds]);

  useEffect(() => {
    if (playSignal === lastPlaySignalRef.current) return;
    lastPlaySignalRef.current = playSignal;
    if (!ready || !playerRef.current || !videoId) return;
    programmaticUntilRef.current = Date.now() + 700;
    try {
      playerRef.current.playVideo();
    } catch {
      // Ignore
    }
  }, [ready, playSignal, videoId]);

  useEffect(() => {
    if (stopSignal === lastStopSignalRef.current) return;
    lastStopSignalRef.current = stopSignal;

    songElapsedMsRef.current = 0;
    autoStoppedRef.current = false;
    callbacksRef.current.onPlaybackProgress?.({
      songElapsedSeconds: 0,
      isAdPlaying: false,
      playerPlaying: false,
    });

    if (!ready || !playerRef.current) return;
    programmaticUntilRef.current = Date.now() + 800;
    try {
      playerRef.current.pauseVideo();
      playerRef.current.seekTo?.(0, true);
    } catch {
      try {
        playerRef.current.stopVideo();
      } catch {
        // Ignore
      }
    }
  }, [ready, stopSignal]);

  useEffect(() => {
    if (!ready || !playerRef.current || !videoId) return;
    programmaticUntilRef.current = Date.now() + 700;

    if (loadedVideoRef.current !== videoId) {
      loadedVideoRef.current = videoId;
      songElapsedMsRef.current = 0;
      autoStoppedRef.current = false;
      callbacksRef.current.onPlaybackProgress?.({
        songElapsedSeconds: 0,
        isAdPlaying: false,
        playerPlaying: isPlaying,
      });
      if (isPlaying) {
        playerRef.current.loadVideoById(videoId);
      } else {
        playerRef.current.cueVideoById(videoId);
      }
    } else if (isPlaying) {
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [ready, videoId, isPlaying]);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="w-full overflow-hidden rounded-xl border border-white/10 bg-black aspect-video max-h-[220px]"
      />
      <p className="text-xs text-slate-400">
        {caption ??
          "Audio plays through the host's device via the official YouTube player. If a video plays an ad first, the 40–50s song timer waits until the actual music begins."}
      </p>
    </div>
  );
}
