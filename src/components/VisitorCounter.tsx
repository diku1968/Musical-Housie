import { Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { subscribeToPublicVisitorCount } from '../services/analyticsService.ts';

interface VisitorCounterProps {
  compact?: boolean;
}

/**
 * Public Website Visitor Counter.
 * Displays ONLY the aggregated total unique visitor count (never exposes user info,
 * online users, game stats, or private analytics, and never allows visitors to reset/edit).
 */
export function VisitorCounter({ compact = false }: VisitorCounterProps) {
  const [totalVisitors, setTotalVisitors] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToPublicVisitorCount(
      (count) => {
        setTotalVisitors(count);
      },
      () => {
        setTotalVisitors((prev) => (prev === null ? 0 : prev));
      },
    );
    return () => unsubscribe();
  }, []);

  const formattedCount =
    totalVisitors === null ? '---' : totalVisitors.toLocaleString('en-US');

  return (
    <div
      className={`no-print inline-flex items-center gap-2 rounded-lg border border-amber-400/25 bg-[#0C1226]/90 shadow-inner select-none ${
        compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
      }`}
      aria-label={
        totalVisitors === null
          ? 'Total Visitors loading'
          : `Total Visitors: ${formattedCount}`
      }
      title="Total unique visitors"
    >
      <Eye
        className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-amber-400 shrink-0`}
        aria-hidden="true"
      />
      <span className="text-slate-300 font-medium whitespace-nowrap">
        Total Visitors:
      </span>
      <span
        className="font-mono font-bold tabular-nums tracking-wider text-amber-300 rounded bg-[#060913] border border-white/10 px-2 py-0.5 leading-none"
        data-testid="public-visitor-count"
      >
        {formattedCount}
      </span>
    </div>
  );
}
