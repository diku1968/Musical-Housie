import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Users,
} from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import {
  type RoomEntryStatusInfo,
  fetchRoomEntryStatus,
} from '../services/gameService.ts';
import { formatCountdownMmSs } from '../shared/gameLogic.ts';
import { GlobalBranding } from './GlobalBranding.tsx';

interface JoinRoomViewProps {
  initialRoomCode?: string;
  onBack: () => void;
  onJoinGame: (playerName: string, roomCode: string) => Promise<void>;
}

export function JoinRoomView({
  initialRoomCode = '',
  onBack,
  onJoinGame,
}: JoinRoomViewProps) {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState(
    initialRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [entryStatus, setEntryStatus] = useState<RoomEntryStatusInfo | null>(null);
  const [checkingRoom, setCheckingRoom] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Check authoritative room & 15-minute late-entry status when a 6-char code is entered
  useEffect(() => {
    const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleanCode.length !== 6) {
      setEntryStatus(null);
      setCheckingRoom(false);
      return;
    }

    let cancelled = false;
    setCheckingRoom(true);
    const timer = window.setTimeout(async () => {
      try {
        const info = await fetchRoomEntryStatus(cleanCode);
        if (cancelled) return;
        setEntryStatus(info);
        setClockOffsetMs(info.serverNowMs - Date.now());
        setNowMs(Date.now());
      } catch {
        if (!cancelled) {
          setEntryStatus(null);
        }
      } finally {
        if (!cancelled) {
          setCheckingRoom(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [roomCode]);

  // Live 1-second countdown synced to server time while late entry is active
  useEffect(() => {
    if (
      !entryStatus?.exists ||
      (entryStatus.status !== 'playing' && entryStatus.status !== 'paused') ||
      entryStatus.deadlineMs == null
    ) {
      return;
    }

    const tick = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(tick);
  }, [entryStatus]);

  const liveRemainingMs =
    entryStatus?.exists &&
    (entryStatus.status === 'playing' || entryStatus.status === 'paused') &&
    entryStatus.deadlineMs != null &&
    !entryStatus.isExpired
      ? Math.max(0, entryStatus.deadlineMs - (nowMs + clockOffsetMs))
      : 0;

  const isExistingParticipant = Boolean(entryStatus?.isExistingPlayer || entryStatus?.isHost);
  const isLateEntryActive =
    Boolean(entryStatus?.exists) &&
    !entryStatus?.isExpired &&
    (entryStatus?.status === 'playing' || entryStatus?.status === 'paused') &&
    liveRemainingMs > 0;
  const isLateEntryClosedForNewPlayer =
    Boolean(entryStatus?.exists) &&
    !entryStatus?.isExpired &&
    (entryStatus?.status === 'playing' || entryStatus?.status === 'paused') &&
    liveRemainingMs === 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = playerName.trim();
    const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!cleanName) {
      setError('Please enter your Player Name.');
      return;
    }
    if (cleanCode.length !== 6) {
      setError('Invalid Ticket Code. Please Check and Try Again.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await onJoinGame(cleanName, cleanCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join room.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 sm:px-6 py-10 sm:py-16">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors mb-6 cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Home</span>
      </button>

      <div className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 shadow-xl space-y-6">
        <GlobalBranding variant="bar" />
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
            Join a Game
          </h1>
          <p className="text-sm text-slate-300">
            Enter your name and the 6-character room code shared by your host.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="player-name" className="block text-sm font-semibold text-slate-200">
              Player Name <span className="text-amber-400">*</span>
            </label>
            <input
              id="player-name"
              type="text"
              required
              maxLength={40}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="e.g., Arjun"
              className="w-full rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="room-code" className="block text-sm font-semibold text-slate-200">
              6-Character Room Code <span className="text-amber-400">*</span>
            </label>
            <input
              id="room-code"
              type="text"
              required
              maxLength={6}
              value={roomCode}
              onChange={(e) => {
                setError('');
                setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
              }}
              placeholder="ABC123"
              className="w-full rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.25em] text-white placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none uppercase"
            />

            {/* Live Room & 15-Minute Late-Entry Status Banner */}
            {roomCode.length === 6 && checkingRoom && !entryStatus && (
              <div className="rounded-xl border border-white/10 bg-[#090D1C] px-3.5 py-2.5 text-xs text-slate-300 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 shrink-0" />
                <span>Checking game status...</span>
              </div>
            )}

            {roomCode.length === 6 && entryStatus && !entryStatus.exists && (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
                <span>Invalid Ticket Code. Please Check and Try Again.</span>
              </div>
            )}

            {roomCode.length === 6 && entryStatus?.exists && entryStatus.isExpired && (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-medium text-rose-200 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
                <span>This room has expired. Ask the host to create a fresh game.</span>
              </div>
            )}

            {roomCode.length === 6 &&
              entryStatus?.exists &&
              !entryStatus.isExpired &&
              entryStatus.status === 'lobby' && (
                <div className="rounded-xl border border-indigo-400/35 bg-indigo-500/15 px-3.5 py-2.5 text-xs font-semibold text-indigo-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-300" />
                    <span>Waiting for Game to Start</span>
                  </div>
                  {entryStatus.gameName && (
                    <span className="truncate text-[11px] font-normal text-indigo-200/80">
                      {entryStatus.gameName}
                    </span>
                  )}
                </div>
              )}

            {roomCode.length === 6 && isLateEntryActive && (
              <div className="rounded-xl border border-emerald-400/45 bg-emerald-500/15 px-3.5 py-3 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
                  <Clock className="h-4 w-4 shrink-0 text-emerald-300" />
                  <span>Game Started – Late Entry Open</span>
                </div>
                <div className="flex items-center justify-between gap-2 pl-6 text-xs text-amber-200">
                  <span>New Player Entry Closes In:</span>
                  <span className="font-mono text-sm font-extrabold text-amber-300 tabular-nums">
                    {formatCountdownMmSs(liveRemainingMs)}
                  </span>
                </div>
              </div>
            )}

            {roomCode.length === 6 && isLateEntryClosedForNewPlayer && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs space-y-1 ${
                  isExistingParticipant
                    ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-100'
                    : 'border-rose-400/45 bg-rose-500/15 text-rose-200'
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>Late Entry Closed</span>
                </div>
                <p className="pl-6 text-[11px] opacity-90">
                  {isExistingParticipant
                    ? 'You are already registered in this game. Tap JOIN GAME to reconnect to your ticket.'
                    : 'Game Started – Late Entry Closed. You can no longer join this game.'}
                </p>
              </div>
            )}

            {roomCode.length === 6 &&
              entryStatus?.exists &&
              !entryStatus.isExpired &&
              entryStatus.status === 'ended' && (
                <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-3.5 py-2.5 text-xs font-semibold text-rose-200 flex items-center gap-2">
                  <Lock className="h-4 w-4 shrink-0 text-rose-300" />
                  <span>
                    {isExistingParticipant
                      ? 'Game Completed – Tap JOIN GAME to view final results'
                      : 'Game Completed – New Entry Not Allowed'}
                  </span>
                </div>
              )}
          </div>

          {error && (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-6 py-4 text-base font-extrabold text-white hover:bg-indigo-400 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Joining Room...</span>
              </>
            ) : (
              <>
                <Users className="h-5 w-5" />
                <span>JOIN GAME</span>
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}

