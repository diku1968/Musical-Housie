import { Check } from 'lucide-react';
import { TicketCell } from '../shared/types.ts';

interface HousieTicketProps {
  ticket: TicketCell[];
  markedSongIds: string[];
  playedSongIds?: string[];
  playedSongNumbers?: number[];
  activeMatchSongId?: string;
  onToggleSong?: (songId: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
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
  playedSongIds = [],
  playedSongNumbers = [],
  activeMatchSongId = '',
  onToggleSong,
  disabled = false,
  readOnly = false,
}: HousieTicketProps) {
  if (ticket.length !== 15) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#121830] p-6 text-center text-sm text-slate-300">
        Your 15-song ticket is being prepared...
      </div>
    );
  }

  const markedSet = new Set(markedSongIds);
  const playedIdSet = new Set(playedSongIds);
  const playedNumberSet = new Set(playedSongNumbers);

  const isCellPlayed = (cell: TicketCell): boolean =>
    playedIdSet.has(cell.id) ||
    (typeof cell.songNumber === 'number' && playedNumberSet.has(cell.songNumber));

  const isCellSelected = (cell: TicketCell): boolean =>
    isCellPlayed(cell) || markedSet.has(cell.id);

  return (
    <div className="space-y-4 print-ticket-rows">
      {ROW_CONFIG.map((row) => {
        const rowPlayedCount = row.indices.filter((idx) => isCellPlayed(ticket[idx])).length;
        const rowSelectedCount = row.indices.filter((idx) => isCellSelected(ticket[idx])).length;
        const countLabel =
          playedSongIds.length > 0 || playedSongNumbers.length > 0
            ? `${rowPlayedCount}/5 played`
            : `${rowSelectedCount}/5 marked`;

        return (
          <div key={row.label} className="space-y-2 print-ticket-row">
            <div className="flex items-center justify-between px-1">
              <span className={`text-xs font-semibold tracking-wide print-row-label ${row.rowBadgeText}`}>
                {row.label}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-400 print-row-count">
                {countLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 print-ticket-grid">
              {row.indices.map((cellIndex) => {
                const cell = ticket[cellIndex];
                const songNum = typeof cell.songNumber === 'number' ? cell.songNumber : cellIndex + 1;
                const played = isCellPlayed(cell);
                const selected = played || markedSet.has(cell.id);
                const isActiveMatch = Boolean(activeMatchSongId && cell.id === activeMatchSongId);
                const isInteractive = !readOnly && !disabled && Boolean(onToggleSong);

                const cellVisualClass = played
                  ? isActiveMatch
                    ? 'ticket-cell-played bg-emerald-500/30 border-emerald-300 ring-2 ring-emerald-300/80 text-white shadow-lg shadow-emerald-950/50'
                    : 'ticket-cell-played bg-emerald-500/25 border-emerald-400 text-white shadow-md shadow-emerald-950/40'
                  : selected
                    ? 'ticket-cell-played bg-emerald-500/20 border-emerald-400 text-white shadow-md shadow-emerald-950/40'
                    : `ticket-cell-unplayed ${row.unmarkedClass} text-slate-100`;

                const content = (
                  <>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ticket-song-number ${
                          selected
                            ? 'bg-emerald-400/25 text-emerald-100 border border-emerald-300/50'
                            : 'bg-white/10 text-slate-300 border border-white/10'
                        }`}
                      >
                        #{songNum}
                      </span>

                      <span
                        className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                          selected
                            ? 'ticket-cell-played-badge border-emerald-300 bg-emerald-400 text-slate-950'
                            : 'ticket-cell-unplayed-badge border-white/20 bg-white/5 text-transparent group-hover:border-white/40'
                        }`}
                        aria-hidden="true"
                      >
                        <Check className="h-3.5 w-3.5 stroke-[3]" />
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="block text-xs sm:text-[13px] font-semibold leading-snug line-clamp-2 break-words ticket-song-title">
                        {cell.title}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-1">
                      <span className="text-[11px] text-slate-400 truncate max-w-[105px] ticket-song-artist">
                        {cell.artist}
                      </span>
                      {played && isActiveMatch ? (
                        <span className="text-[10px] font-extrabold text-emerald-200 shrink-0 ticket-status-played">
                          Playing ✓
                        </span>
                      ) : played ? (
                        <span className="text-[10px] font-bold text-emerald-300 shrink-0 ticket-status-played">
                          Played ✓
                        </span>
                      ) : selected ? (
                        <span className="text-[10px] font-semibold text-emerald-300 shrink-0 ticket-status-played">
                          Marked ✓
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 shrink-0 ticket-status-unplayed">
                          Unplayed
                        </span>
                      )}
                    </div>
                  </>
                );

                if (readOnly) {
                  return (
                    <div
                      key={cell.id}
                      data-song-id={cell.id}
                      data-song-number={songNum}
                      data-played={played ? 'true' : 'false'}
                      className={`relative flex flex-col justify-between rounded-xl border p-3 text-left min-h-[92px] transition-all duration-150 ${cellVisualClass}`}
                    >
                      {content}
                    </div>
                  );
                }

                return (
                  <button
                    key={cell.id}
                    type="button"
                    disabled={disabled}
                    data-song-id={cell.id}
                    data-song-number={songNum}
                    data-played={played ? 'true' : 'false'}
                    onClick={() => isInteractive && onToggleSong?.(cell.id)}
                    aria-pressed={selected}
                    className={`group relative flex flex-col justify-between rounded-xl border p-3 text-left min-h-[92px] transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                      disabled ? 'cursor-not-allowed opacity-85' : 'cursor-pointer active:scale-[0.98]'
                    } ${cellVisualClass}`}
                  >
                    {content}
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
