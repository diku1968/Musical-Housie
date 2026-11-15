import { Check } from 'lucide-react';
import { TicketCell } from '../shared/types.ts';

interface HousieTicketProps {
  ticket: TicketCell[];
  markedSongIds: string[];
  activeMatchSongId?: string;
  onToggleSong: (songId: string) => void;
  disabled?: boolean;
}

const ROW_CONFIG = [
  {
    label: 'Top Row',
    indices: [0, 1, 2, 3, 4],
    unmarkedClass:
      'bg-indigo-950/55 border-indigo-400/20 hover:border-indigo-400/50 hover:bg-indigo-900/45',
    rowBadgeText: 'text-indigo-300',
  },
  {
    label: 'Middle Row',
    indices: [5, 6, 7, 8, 9],
    unmarkedClass:
      'bg-violet-950/55 border-violet-400/20 hover:border-violet-400/50 hover:bg-violet-900/45',
    rowBadgeText: 'text-violet-300',
  },
  {
    label: 'Bottom Row',
    indices: [10, 11, 12, 13, 14],
    unmarkedClass:
      'bg-amber-950/35 border-amber-400/20 hover:border-amber-400/50 hover:bg-amber-900/35',
    rowBadgeText: 'text-amber-300',
  },
];

export function HousieTicket({
  ticket,
  markedSongIds,
  activeMatchSongId = '',
  onToggleSong,
  disabled = false,
}: HousieTicketProps) {
  if (ticket.length !== 15) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#121830] p-6 text-center text-sm text-slate-300">
        Your 15-song ticket is being prepared...
      </div>
    );
  }

  const markedSet = new Set(markedSongIds);

  return (
    <div className="space-y-4">
      {ROW_CONFIG.map((row) => {
        const rowMarkedCount = row.indices.filter((idx) => markedSet.has(ticket[idx].id)).length;
        return (
          <div key={row.label} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className={`text-xs font-semibold tracking-wide ${row.rowBadgeText}`}>
                {row.label}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {rowMarkedCount}/5 marked
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {row.indices.map((cellIndex) => {
                const cell = ticket[cellIndex];
                const isMarked = markedSet.has(cell.id);
                const isActiveMatch = Boolean(activeMatchSongId && cell.id === activeMatchSongId);
                return (
                  <button
                    key={cell.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onToggleSong(cell.id)}
                    aria-pressed={isMarked}
                    className={`group relative flex flex-col justify-between rounded-xl border p-3 text-left min-h-[76px] transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      disabled ? 'cursor-not-allowed opacity-75' : 'cursor-pointer active:scale-[0.98]'
                    } ${
                      isActiveMatch
                        ? 'bg-amber-400/20 border-amber-300 ring-2 ring-amber-400/70 text-white shadow-lg shadow-amber-950/50'
                        : isMarked
                          ? 'bg-emerald-500/20 border-emerald-400 text-white shadow-md shadow-emerald-950/40'
                          : `${row.unmarkedClass} text-slate-100`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs sm:text-[13px] font-semibold leading-snug line-clamp-2 break-words">
                        {cell.title}
                      </span>
                      <span
                        className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                          isMarked
                            ? 'border-emerald-300 bg-emerald-400 text-slate-950'
                            : 'border-white/20 bg-white/5 text-transparent group-hover:border-white/40'
                        }`}
                        aria-hidden="true"
                      >
                        <Check className="h-3.5 w-3.5 stroke-[3]" />
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-1">
                      <span className="text-[11px] text-slate-400 truncate max-w-[110px]">
                        {cell.artist}
                      </span>
                      {isActiveMatch ? (
                        <span className="text-[10px] font-bold text-amber-300 shrink-0">
                          Playing!
                        </span>
                      ) : isMarked ? (
                        <span className="text-[10px] font-semibold text-emerald-300 shrink-0">
                          Marked
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
