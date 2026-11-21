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

// Client-side direct YouTube Title Resolver without backend /api/ server
async function fetchYouTubeVideoTitle(videoId: string): Promise<{ title: string; author: string }> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    if (res.ok) {
      const data = await res.json();
      if (data.title) {
        return {
          title: data.title,
          author: data.author_name || 'YouTube Music',
        };
      }
    }
  } catch {
    // Fallback if noembed is blocked
  }

  return {
    title: `Song #${videoId.slice(0, 6)}`,
    author: 'YouTube',
  };
}

/**
 * Client-Side YouTube IFrame Player API playlist resolver
 * Works completely static on GitHub Pages without requiring Node.js backend
 */
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

    // Resolve titles directly on client side in chunks
    const tracks: TrackItem[] = [];
    const problemTracks: ProblemTrackItem[] = [];

    // Filter duplicates
    const uniqueIds = Array.from(new Set(videoIds)).slice(0, 100);

    for (let i = 0; i < uniqueIds.length; i++) {
      const vid = uniqueIds[i];
      try {
        const meta = await fetchYouTubeVideoTitle(vid);
        tracks.push({
          id: `yt_${vid}`,
          title: meta.title.slice(0, 120),
          artist: meta.author.slice(0, 80),
          sourceType: 'youtube',
          sourceId: vid,
          thumbnailUrl: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
        });
      } catch {
        problemTracks.push({
          position: i + 1,
          sourceId: vid,
          title: `Video ID ${vid}`,
          artist: 'YouTube',
          reason: 'Could not fetch metadata',
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
      // Ignore cleanup errors
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
                callbacks
