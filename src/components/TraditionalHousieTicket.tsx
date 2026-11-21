import { Check } from 'lucide-react';
import { TicketCell } from '../shared/types.ts';

interface TraditionalHousieTicketProps {
  ticket: TicketCell[];
  markedSongIds: string[];
  playedSongIds?: string[];
  playedSongNumbers?: number[];
  activeMatchSongId?: string;
  onToggleSong?: (songId: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  presenterName?: string;
  gameName?: string;
  ticketNumber?: number;
  playerName?: string;
}

function formatPresenterLine(presenterName?: string): string {
  const cleaned = presenterName?.trim();
  if (!cleaned) return 'Dhiren Pathak Present';
  if (/\bpresent(s)?$/i.test(cleaned)) return cleaned;
  return `${cleaned} Present`;
}

function formatTraditionalTicketNo(ticketNumber?: number): string {
  if (!ticketNumber || ticketNumber < 1) return 'Ticket #001';
  return `Ticket #${String(ticketNumber).padStart(3, '0')}`;
}

/**
 * Additional Traditional Printed Musical Housie Ticket Presentation Component.
 * Landscape 3 Rows × 5 Columns (15 equal boxes), cream/ivory paper background,
 * golden/brown rounded border, white golden-bordered song boxes, dark purple typography,
 * and Gujarati Unicode support. Reuses the exact existing ticket data and marking state.
 */
export function TraditionalHousieTicket({
  ticket,
  markedSongIds,
  playedSongIds = [],
  playedSongNumbers = [],
  activeMatchSongId = '',
  onToggleSong,
  disabled = false,
  readOnly = false,
  presenterName,
  gameName,
  ticketNumber,
  playerName,
}: TraditionalHousieTicketProps) {
  if (ticket.length !== 15) {
    return (
      <div className="rounded-2xl border border-[#C9A25B]/60 bg-[#FDF8EC] p-6 text-center text-sm font-medium text-[#3B1B54]">
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

  const headingPresenter = formatPresenterLine(presenterName);
  const headingEvent = (gameName?.trim() || 'MUSICAL HOUSIE').toUpperCase();
  const formattedTicketNo = formatTraditionalTicketNo(ticketNumber);

  return (
    <div className="w-full space-y-2">
      {/* Helpful mobile landscape hint; never converts 3×5 grid to portrait */}
      <p className="sm:hidden no-print text-[11px] text-center text-amber-200/85">
        Rotate phone to landscape or swipe sideways to view the complete 3×5 ticket
      </p>

      <div className="w-full overflow-x-auto pb-1 traditional-ticket-scroll">
        <div className="traditional-housie-card min-w-[620px] w-full rounded-2xl border-[3px] border-[#9C6B2F] bg-[#FDF8EC] p-2 sm:p-3 text-[#3B1B54] shadow-xl shadow-black/35">
          {/* Traditional inner golden frame */}
          <div className="traditional-housie-inner rounded-xl border border-[#C9A25B] bg-[#FFFDF7]/75 px-3 py-3 sm:px-5 sm:py-4 space-y-3">
            {/* Centered Traditional Ticket Heading */}
            <div className="traditional-housie-header text-center space-y-1">
              <p className="traditional-housie-presenter text-xs sm:text-sm font-semibold tracking-wide text-[#6B3F7D]">
                {headingPresenter}
              </p>
              <h3 className="traditional-housie-heading font-display text-lg sm:text-2xl font-extrabold tracking-wider text-[#3B1B54] leading-tight text-balance">
                {headingEvent}
              </h3>

              {/* Ticket #001 (Left) · Player (Optional Center) · 15 Songs (Right) */}
              <div className="mt-2 pt-2 border-t border-b border-[#D4AF6A]/75 py-1.5 flex items-center justify-between gap-4 text-xs sm:text-sm font-bold text-[#3B1B54]">
                <span className="font-mono tabular-nums tracking-wide text-[#4A1D6B]">
                  {formattedTicketNo}
                </span>
                {playerName && (
                  <span className="truncate text-xs font-semibold text-[#6B3F7D] max-w-[45%]">
                    {playerName}
                  </span>
                )}
                <span className="font-mono tabular-nums tracking-wide text-[#4A1D6B] shrink-0">
                  {ticket.length} Songs
                </span>
              </div>
            </div>

            {/* Strict 3 Rows × 5 Columns Equal-Dimension Landscape Song Grid */}
            <div
              role="grid"
              aria-label={`${headingEvent} 3 by 5 song ticket`}
              className="traditional-housie-grid grid grid-cols-5 grid-rows-3 gap-2 sm:gap-2.5"
            >
              {ticket.map((cell, cellIndex) => {
                const songNum =
                  typeof cell.songNumber === 'number' ? cell.songNumber : cellIndex + 1;
                const played = isCellPlayed(cell);
                const selected = played || markedSet.has(cell.id);
                const isActiveMatch = Boolean(activeMatchSongId && cell.id === activeMatchSongId);
                const isInteractive = !readOnly && !disabled && Boolean(onToggleSong);

                const cellVisualClass = played
                  ? isActiveMatch
                    ? 'traditional-cell-played bg-[#DCFCE7] border-[#16A34A] ring-2 ring-[#16A34A] text-[#14532D] shadow-sm'
                    : 'traditional-cell-played bg-[#DCFCE7] border-[#16A34A] text-[#14532D]'
                  : selected
                    ? 'traditional-cell-played bg-[#ECFDF5] border-[#22C55E] text-[#14532D]'
                    : 'traditional-cell-unplayed bg-white border-[#C9A25B] text-[#3B1B54] hover:border-[#9C6B2F] hover:bg-[#FFFBF0]';

                const cellInner = (
                  <>
                    <div className="w-full flex items-center justify-between gap-1">
                      <span
                        className={`font-mono text-[10px] font-bold tabular-nums leading-none ${
                          selected ? 'text-[#15803D]' : 'text-[#8C6239]'
                        }`}
                      >
                        {songNum}
                      </span>

                      {selected ? (
                        <span
                          className="traditional-played-badge shrink-0 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#16A34A] text-white"
                          aria-label={played ? 'Played' : 'Marked'}
                        >
                          <Check className="h-2.5 w-2.5 stroke-[3]" />
                        </span>
                      ) : (
                        <span
                          className="shrink-0 inline-block h-3.5 w-3.5 rounded-full border border-[#D4AF6A]/65 bg-[#FDF8EC]/60"
                          aria-hidden="true"
                        />
                      )}
                    </div>

                    <div className="flex-1 w-full flex items-center justify-center px-0.5 py-0.5 overflow-hidden">
                      <span className="housie-song-text traditional-song-title block w-full text-center text-[11px] sm:text-xs md:text-[13px] font-bold leading-[1.4] line-clamp-3 break-words">
                        {cell.title}
                      </span>
                    </div>

                    <div className="w-full text-center leading-none min-h-[12px]">
                      {played && isActiveMatch ? (
                        <span className="text-[9px] font-extrabold uppercase tracking-wide text-[#15803D]">
                          Playing ✓
                        </span>
                      ) : played ? (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-[#15803D]">
                          Played ✓
                        </span>
                      ) : selected ? (
                        <span className="text-[9px] font-semibold uppercase tracking-wide text-[#15803D]">
                          Marked ✓
                        </span>
                      ) : cell.artist ? (
                        <span className="block truncate text-[9px] font-medium text-[#7C5A8E]">
                          {cell.artist}
                        </span>
                      ) : null}
                    </div>
                  </>
                );

                const sharedBoxClasses =
                  'traditional-song-cell relative flex flex-col items-center justify-between rounded-lg border-[1.5px] px-2 py-2 h-[96px] sm:h-[106px] md:h-[112px] w-full transition-colors duration-150 overflow-hidden';

                if (readOnly) {
                  return (
                    <div
                      key={cell.id}
                      role="gridcell"
                      data-song-id={cell.id}
                      data-song-number={songNum}
                      data-played={played ? 'true' : 'false'}
                      title={`${cell.title}${cell.artist ? ` — ${cell.artist}` : ''}`}
                      className={`${sharedBoxClasses} ${cellVisualClass}`}
                    >
                      {cellInner}
                    </div>
                  );
                }

                return (
                  <button
                    key={cell.id}
                    type="button"
                    role="gridcell"
                    disabled={disabled}
                    data-song-id={cell.id}
                    data-song-number={songNum}
                    data-played={played ? 'true' : 'false'}
                    title={`${cell.title}${cell.artist ? ` — ${cell.artist}` : ''}`}
                    onClick={() => isInteractive && onToggleSong?.(cell.id)}
                    aria-pressed={selected}
                    className={`${sharedBoxClasses} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9C6B2F] ${
                      disabled ? 'cursor-not-allowed opacity-90' : 'cursor-pointer active:scale-[0.98]'
                    } ${cellVisualClass}`}
                  >
                    {cellInner}
                  </button>
                );
              })}
            </div>

            {/* Traditional Printed Ticket Footer */}
            <div className="traditional-housie-footer pt-2 border-t border-[#D4AF6A]/75 text-center text-[11px] sm:text-xs font-bold tracking-wide text-[#5A2D74]">
              Early 5 • Lines • Four Corners • Full House
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
