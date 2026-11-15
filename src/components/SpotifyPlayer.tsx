import { useEffect, useRef, useState } from 'react';
import type { PlaybackProgressInfo } from './YouTubePlayer.tsx';

interface SpotifyPlayerProps {
  trackId: string;
  previewUrl?: string;
  isPlaying: boolean;
  stopSignal?: number;
  clipDurationSeconds?: number | null;
  onAutoStop?: () => void;
  onPlaybackProgress?: (info: PlaybackProgressInfo) => void;
}

export function SpotifyPlayer({
  trackId,
  isPlaying,
  stopSignal = 0,
  clipDurationSeconds = null,
  onAutoStop,
  onPlaybackProgress,
}: SpotifyPlayerProps) {
  const [embedResetCount, setEmbedResetCount] = useState(0);
  const elapsedMsRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const autoStoppedRef = useRef(false);
  const lastStopSignalRef = useRef(stopSignal);

  const callbacksRef = useRef({ onAutoStop, onPlaybackProgress });
  callbacksRef.current = { onAutoStop, onPlaybackProgress };

  useEffect(() => {
    elapsedMsRef.current = 0;
    autoStoppedRef.current = false;
    callbacksRef.current.onPlaybackProgress?.({
      songElapsedSeconds: 0,
      isAdPlaying: false,
      playerPlaying: isPlaying,
    });
  }, [trackId]);

  useEffect(() => {
    if (stopSignal === lastStopSignalRef.current) return;
    lastStopSignalRef.current = stopSignal;
    elapsedMsRef.current = 0;
    autoStoppedRef.current = false;
    setEmbedResetCount((n) => n + 1);
    callbacksRef.current.onPlaybackProgress?.({
      songElapsedSeconds: 0,
      isAdPlaying: false,
      playerPlaying: false,
    });
  }, [stopSignal]);

  useEffect(() => {
    if (!clipDurationSeconds || Math.floor(elapsedMsRef.current / 1000) < clipDurationSeconds) {
      autoStoppedRef.current = false;
    }
  }, [clipDurationSeconds]);

  useEffect(() => {
    if (!trackId) return;
    lastTickRef.current = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.min(1000, Math.max(0, now - lastTickRef.current));
      lastTickRef.current = now;

      if (isPlaying) {
        elapsedMsRef.current += dt;
      }
      const elapsedSeconds = Math.floor(elapsedMsRef.current / 1000);
      callbacksRef.current.onPlaybackProgress?.({
        songElapsedSeconds: elapsedSeconds,
        isAdPlaying: false,
        playerPlaying: isPlaying,
      });

      if (
        clipDurationSeconds &&
        clipDurationSeconds > 0 &&
        isPlaying &&
        elapsedSeconds >= clipDurationSeconds &&
        !autoStoppedRef.current
      ) {
        autoStoppedRef.current = true;
        setEmbedResetCount((n) => n + 1);
        callbacksRef.current.onAutoStop?.();
      }
    }, 500);

    return () => window.clearInterval(timer);
  }, [trackId, isPlaying, clipDurationSeconds]);

  if (!trackId) return null;

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0B1022]">
        <iframe
          key={`${trackId}_${embedResetCount}`}
          title="Spotify Embed Player"
          src={`https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}?utm_source=generator&theme=0`}
          width="100%"
          height="152"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          className="border-0"
        />
      </div>
      <p className="text-xs text-slate-400">
        Press play inside the Spotify widget if browser autoplay pauses it. Clicking STOP resets the player immediately to silence audio.
      </p>
    </div>
  );
}
