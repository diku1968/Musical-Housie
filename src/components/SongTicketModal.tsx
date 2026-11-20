import { Check, Printer, X } from 'lucide-react';
import { useEffect } from 'react';
import { formatTicketNumber } from '../shared/gameLogic.ts';
import { RoomStatus, TicketCell } from '../shared/types.ts';
import { GlobalBranding } from './GlobalBranding.tsx';
import { HousieTicket } from './HousieTicket.tsx';

interface SongTicketModalProps {
  open: boolean;
  onClose: () => void;
  playerName: string;
  ticketNumber: number;
  roomCode: string;
  gameName?: string;
  ticket: TicketCell[];
  markedSongIds: string[];
  playedSongIds: string[];
  playedSongNumbers?: number[];
  activeSongId?: string;
  roomStatus?: RoomStatus;
  autoPrintOnOpen?: boolean;
  onAutoPrintHandled?: () => void;
}

export function SongTicketModal({
  open,
  onClose,
  playerName,
  ticketNumber,
  roomCode,
  gameName,
  ticket,
  markedSongIds,
  playedSongIds,
  playedSongNumbers = [],
  activeSongId = '',
  roomStatus,
  autoPrintOnOpen = false,
  onAutoPrintHandled,
}: SongTicketModalProps) {
  useEffect(() => {
    if (!open || !autoPrintOnOpen) return;
    const timer = window.setTimeout(() => {
      window.print();
      onAutoPrintHandled?.();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, autoPrintOnOpen, onAutoPrintHandled]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const playedIdSet = new Set(playedSongIds);
  const playedNumberSet = new Set(playedSongNumbers);
  const playedOnTicketCount = ticket.filter(
    (cell) =>
      playedIdSet.has(cell.id) ||
      (typeof cell.songNumber === 'number' && playedNumberSet.has(cell.songNumber)),
  ).length;

  const statusLabel =
    roomStatus === 'playing'
      ? 'Live · Playing'
      : roomStatus === 'paused'
        ? 'Live · Paused'
        : roomStatus === 'ended'
          ? 'Game Ended'
          : 'Live Session';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="song-ticket-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto print-modal-backdrop"
    >
      <div className="print-ticket-root w-full max-w-5xl rounded-3xl border border-white/15 bg-[#10162D] p-4 sm:p-6 shadow-2xl space-y-5 my-auto">
        {/* Top Modal & Print Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-white/10 pb-4 print-ticket-header">
          <div className="space-y-2">
            <div className="no-print">
              <GlobalBranding variant="bar" />
            </div>
            <div className="hidden print-only-brand text-xs font-bold tracking-wide uppercase text-slate-700">
              Dhiren Pathak Present Musical Housie
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2
                id="song-ticket-modal-title"
                className="font-display text-xl sm:text-2xl font-extrabold text-white print-title"
              >
                Song Ticket — {playerName}
              </h2>
              {ticketNumber > 0 && (
                <span className="rounded-lg border border-amber-400/40 bg-amber-400/15 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-200 tabular-nums print-ticket-badge">
                  Ticket {formatTicketNumber(ticketNumber)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 print-subtitle">
              <span>{gameName || 'Musical Housie'}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-bold">Room {roomCode}</span>
              <span aria-hidden="true">·</span>
              <span>{statusLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-bold text-emerald-300 print-played-summary tabular-nums">
                {playedOnTicketCount} / {ticket.length || 15} Played
              </span>
            </div>
          </div>

          {/* Actions (hidden during printing) */}
          <div className="flex items-center gap-2 shrink-0 no-print">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Print Ticket</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close song ticket view"
              className="rounded-xl border border-white/15 bg-white/5 p-2.5 text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Live Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#090D1C] px-4 py-2.5 text-xs print-legend">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-2 text-emerald-200 font-semibold print-legend-played">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-400 text-slate-950 ticket-cell-played-badge">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
              <span>Played / Selected (Live Synced)</span>
            </span>
            <span className="inline-flex items-center gap-2 text-slate-300 print-legend-unplayed">
              <span className="inline-block h-4 w-4 rounded border border-white/25 bg-white/5 ticket-cell-unplayed-badge" />
              <span>Not Yet Played</span>
            </span>
          </div>
          <span className="text-[11px] text-slate-400 no-print">
            Updates automatically as the host plays songs
          </span>
        </div>

        {/* Full 3x5 Song Ticket */}
        <div className="max-h-[68vh] overflow-y-auto pr-1 print-ticket-body">
          <HousieTicket
            ticket={ticket}
            markedSongIds={markedSongIds}
            playedSongIds={playedSongIds}
            playedSongNumbers={playedSongNumbers}
            activeMatchSongId={activeSongId}
            readOnly
          />
        </div>
      </div>
    </div>
  );
}
