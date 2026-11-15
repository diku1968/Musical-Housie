import { useEffect, useState } from 'react';

interface MusicVisualizerProps {
  isPlaying: boolean;
  compact?: boolean;
}

const BAR_COUNT = 28;

export function MusicVisualizer({ isPlaying, compact = false }: MusicVisualizerProps) {
  const [heights, setHeights] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, (_, i) => 18 + ((i * 11) % 36)),
  );

  useEffect(() => {
    if (!isPlaying) {
      setHeights(Array.from({ length: BAR_COUNT }, (_, i) => 12 + ((i * 7) % 14)));
      return;
    }

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setHeights(Array.from({ length: BAR_COUNT }, (_, i) => 28 + ((i * 13) % 45)));
      return;
    }

    const interval = window.setInterval(() => {
      setHeights((prev) =>
        prev.map((_, idx) => {
          const wave = Math.sin(Date.now() / 190 + idx * 0.45) * 24;
          const jitter = Math.random() * 48;
          return Math.max(12, Math.min(96, Math.round(28 + wave + jitter)));
        }),
      );
    }, 150);

    return () => window.clearInterval(interval);
  }, [isPlaying]);

  return (
    <div
      aria-label={isPlaying ? 'Music playing visualizer' : 'Music paused visualizer'}
      className={`flex items-end justify-center gap-1 rounded-xl bg-[#0B1022] border border-white/10 px-3 ${
        compact ? 'h-14 py-2' : 'h-24 py-3'
      }`}
    >
      {heights.map((height, idx) => {
        const isAmber = idx % 7 === 0;
        const isViolet = idx % 3 === 0;
        return (
          <div
            key={idx}
            style={{
              height: `${height}%`,
              transition: 'height 150ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className={`w-1.5 sm:w-2 rounded-t-sm ${
              !isPlaying
                ? 'bg-slate-600/50'
                : isAmber
                  ? 'bg-amber-400'
                  : isViolet
                    ? 'bg-violet-400'
                    : 'bg-indigo-400'
            }`}
          />
        );
      })}
    </div>
  );
}
