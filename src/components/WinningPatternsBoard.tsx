import { CheckCircle2, Trophy } from 'lucide-react';
import { formatTicketNumber, getPatternProgress } from '../shared/gameLogic.ts';
import {
  ALL_PATTERNS,
  PATTERN_LABELS,
  TicketCell,
  WinnerRecord,
  WinningPattern,
} from '../shared/types.ts';

interface WinningPatternsBoardProps {
  enabledPatterns: WinningPattern[];
  winners: WinnerRecord[];
  ticket?: TicketCell[];
  markedSongIds?: string[];
  currentPlayerUid?: string;
}

function formatWinningTime(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export function WinningPatternsBoard({
  enabledPatterns,
  winners,
  ticket,
  markedSongIds = [],
  currentPlayerUid,
}: WinningPatternsBoardProps) {
  const orderedPatterns = ALL_PATTERNS.filter((p) => enabledPatterns.includes(p));

  const winnersByPattern = new Map<WinningPattern, WinnerRecord[]>();
  for (const pattern of orderedPatterns) {
    winnersByPattern.set(pattern, []);
  }
  const sortedWinners = [...winners].sort(
    (a, b) => a.approvedAtMs - b.approvedAtMs || a.id.localeCompare(b.id),
  );
  for (const record of sortedWinners) {
    const list = winnersByPattern.get(record.pattern);
    if (list) {
      list.push(record);
    }
  }

  const latestWinner =
    sortedWinners.length > 0 ? sortedWinners[sortedWinners.length - 1] : null;

  return (
    <section className="rounded-3xl border border-white/10 bg-[#121830] p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Trophy className="h-5 w-5 text-amber-300 shrink-0" />
          <div>
            <h2 className="font-display text-base sm:text-lg font-bold text-white">
              Winning Patterns · Independent Winners
            </h2>
            <p className="text-xs text-slate-400">
              All enabled patterns are active in any order. Multiple players can win each pattern.
            </p>
          </div>
        </div>
        <span className="font-mono text-xs font-bold text-amber-300 tabular-nums">
          Total Winners: {sortedWinners.length}
        </span>
      </div>

      {latestWinner && (
        <div className="rounded-2xl border border-amber-400/50 bg-gradient-to-r from-amber-500/20 via-emerald-500/15 to-indigo-500/15 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
              Latest Winner Declared · {PATTERN_LABELS[latestWinner.pattern]}
            </div>
            <div className="font-display text-base sm:text-lg font-extrabold text-white truncate">
              {latestWinner.playerName}
              {currentPlayerUid && latestWinner.playerUid === currentPlayerUid ? ' (You!)' : ''}
              <span className="ml-2 font-mono text-xs font-semibold text-indigo-200">
                Ticket {formatTicketNumber(latestWinner.ticketNumber)}
              </span>
            </div>
          </div>
          <span className="font-mono text-xs font-semibold text-emerald-200 shrink-0 tabular-nums">
            {formatWinningTime(latestWinner.approvedAtMs)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {orderedPatterns.map((pattern) => {
          const patternWinners = winnersByPattern.get(pattern) || [];
          const playerWonThis = Boolean(
            currentPlayerUid && patternWinners.some((w) => w.playerUid === currentPlayerUid),
          );
          const progress =
            ticket && ticket.length === 15
              ? getPatternProgress(ticket, markedSongIds, pattern)
              : null;

          return (
            <div
              key={pattern}
              className={`rounded-2xl border p-4 space-y-3 flex flex-col ${
                patternWinners.length > 0
                  ? 'border-emerald-400/40 bg-emerald-500/8'
                  : 'border-white/10 bg-[#090D1C]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm sm:text-base font-extrabold text-white">
                    {PATTERN_LABELS[pattern]}
                  </h3>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {progress ? (
                      playerWonThis ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>You won this pattern</span>
                        </span>
                      ) : (
                        <span className="font-mono tabular-nums">
                          Your progress: {progress.matched}/{progress.required}
                        </span>
                      )
                    ) : (
                      <span>Open for all players</span>
                    )}
                  </div>
                </div>

                <span className="rounded-lg border border-amber-400/35 bg-amber-400/12 px-2.5 py-1 font-mono text-xs font-bold text-amber-200 tabular-nums shrink-0">
                  {patternWinners.length}{' '}
                  {patternWinners.length === 1 ? 'Winner' : 'Winners'}
                </span>
              </div>

              {patternWinners.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-xs text-slate-400 text-center">
                  No winners yet · Open
                </div>
              ) : (
                <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#090D1C]/85 max-h-48 overflow-y-auto">
                  {patternWinners.map((winner, idx) => {
                    const isYou = Boolean(
                      currentPlayerUid && winner.playerUid === currentPlayerUid,
                    );
                    return (
                      <div
                        key={winner.id || `${winner.pattern}_${winner.playerUid}`}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-bold text-amber-300 shrink-0 tabular-nums">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate">
                              {winner.playerName}
                              {isYou ? ' (You!)' : ''}
                            </div>
                            <div className="text-[11px] font-mono text-indigo-300 tabular-nums">
                              Ticket {formatTicketNumber(winner.ticketNumber)}
                            </div>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                          {formatWinningTime(winner.approvedAtMs)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
