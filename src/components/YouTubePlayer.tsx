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

// Client-side direct title resolver without any backend /api/ server
async function fetchYouTubeVideoTitle(videoId: string): Promise<{ title: string; author: string }> {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.title) {
        return {
          title: data.title,
          author: data.author_name || 'YouTube Music',
        };
      }
    }
  } catch {
    // Fallback if network or service unavailable
  }

  return {
    title: `Song #${videoId.slice(0, 6)}`,
    author: 'YouTube',
  };
}

/**
 * Client-Side YouTube IFrame Player API playlist resolver
 * Resolves playlists without requiring a backend server
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
                  event.target.cuePlaylist({ listType: 'playlist', list: playlist
