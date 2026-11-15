import confetti from 'canvas-confetti';
import {
  Award,
  BellRing,
  CheckCircle2,
  Loader2,
  Sparkles,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  autoMarkPlayerSongs,
  submitWinnerClaim,
  subscribeToClaimsForPlayer,
  subscribeToRoom,
  subscribeToRoomWinners,
  subscribeToSinglePlayer,
  togglePlayerTicketMark,
  updatePlayerOnlineStatus,
} from '../services/gameService.ts';
import {
  formatTicketNumber,
  getPatternProgress,
  isClientTicketReadyForPattern,
} from '../shared/gameLogic.ts';
import {
  ALL_PATTERNS,
  PATTERN_DESCRIPTIONS,
  PATTERN_LABELS,
  PlayerData,
  RoomData,
  TicketCell,
  WinnerClaim,
  WinnerRecord,
  WinningPattern,
} from '../shared/types.ts';
import { HousieTicket } from './HousieTicket.tsx';
import { MusicVisualizer } from './MusicVisualizer.tsx';
import { WinningPatternsBoard } from './WinningPatternsBoard.tsx';
import { YouTubePlayer } from './YouTubePlayer.tsx';

interface PlayerGameViewProps {
  roomCode: string;
  playerUid: string;
  onExitRoom: () => void;
}

function playMatchChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [587.33, 880]; // D5 -> A5 chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);
      gain.gain.setValueAtTime(0.001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.26);
    });
  } catch {
    // Ignore blocked audio context
  }
}

export function PlayerGameView({ roomCode, playerUid, onExitRoom }: PlayerGameViewProps) {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [claims, setClaims] = useState<WinnerClaim[]>([]);
  const [winners, setWinners] = useState<WinnerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimFeedback, setClaimFeedback] = useState('');
  const prevWinnersCountRef = useRef(0);

  // Phone audio & auto-tick controls
  const [phoneAudioEnabled, setPhoneAudioEnabled] = useState(false);
  const [phoneAudioPlaySignal, setPhoneAudioPlaySignal] = useState(0);
  const [phonePlayerActive, setPhonePlayerActive] = useState(false);
  const [autoTickEnabled, setAutoTickEnabled] = useState(true);
  const [matchAlert, setMatchAlert] = useState<{ songId: string; title: string; artist: string; autoTicked: boolean } | null>(null);

  const notifiedMatchRef = useRef<string>('');
  const autoMarkingSigRef = useRef<string>('');
  const spotifyAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsubRoom = subscribeToRoom(
      roomCode,
      (data) => {
        setRoom(data);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    const unsubPlayer = subscribeToSinglePlayer(
      roomCode,
      playerUid,
      (data) => setPlayer(data),
      (err) => setError(err.message),
    );

    const unsubClaims = subscribeToClaimsForPlayer(
      roomCode,
      playerUid,
      (list) => setClaims(list),
      (err) => setError(err.message),
    );

    const unsubWinners = subscribeToRoomWinners(
      roomCode,
      (list) => setWinners(list),
      (err) => setError(err.message),
    );

    updatePlayerOnlineStatus(roomCode, true);

    const handleOnline = () => {
      setIsOffline(false);
      updatePlayerOnlineStatus(roomCode, true);
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      unsubRoom();
      unsubPlayer();
      unsubClaims();
      unsubWinners();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [roomCode, playerUid]);

  useEffect(() => {
    const count = winners.length;
    if (count > prevWinnersCountRef.current) {
      confetti({ particleCount: 75, spread: 70, origin: { y: 0.65 } });
    }
    prevWinnersCountRef.current = count;
  }, [winners.length]);

  const activeSongId =
    room?.currentMedia?.songId ||
    (room?.currentSongRevealed ? room.revealedCurrentSong?.id : '') ||
    '';

  const activeMatchCell: TicketCell | null = useMemo(() => {
    if (!player || !activeSongId || room?.status === 'lobby' || room?.status === 'ended') {
      return null;
    }
    return player.ticket.find((cell) => cell.id === activeSongId) || null;
  }, [player, activeSongId, room?.status]);

  // Notify player & auto-tick matched song(s) on ticket
  useEffect(() => {
    if (!room || !player || room.status === 'lobby' || room.status === 'ended') {
      setMatchAlert(null);
      return;
    }

    const playedTicketIds = new Set<string>();
    if (activeSongId) playedTicketIds.add(activeSongId);
    for (const rev of room.revealedSongs || []) {
      if (rev.id) playedTicketIds.add(rev.id);
    }

    const ticketMatchedIds = player.ticket
      .filter((c) => playedTicketIds.has(c.id))
      .map((c) => c.id);

    if (autoTickEnabled && ticketMatchedIds.length > 0) {
      const markedSet = new Set(player.markedSongIds);
      const missing = ticketMatchedIds.filter((id) => !markedSet.has(id));
      if (missing.length > 0) {
        const sig = `${room.currentSongNumber}:${missing.join(',')}`;
        if (autoMarkingSigRef.current !== sig) {
          autoMarkingSigRef.current = sig;
          autoMarkPlayerSongs(roomCode, playerUid, player.markedSongIds, missing).catch(() => {
            autoMarkingSigRef.current = '';
          });
        }
      }
    }

    if (activeMatchCell) {
      setMatchAlert({
        songId: activeMatchCell.id,
        title: activeMatchCell.title,
        artist: activeMatchCell.artist,
        autoTicked: autoTickEnabled,
      });

      if (notifiedMatchRef.current !== activeMatchCell.id) {
        notifiedMatchRef.current = activeMatchCell.id;
        playMatchChime();
        try {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([120, 60, 120]);
          }
        } catch {
          // Ignore unsupported vibration
        }
      }
    } else {
      setMatchAlert(null);
    }
  }, [
    room,
    player,
    activeSongId,
    activeMatchCell,
    autoTickEnabled,
    roomCode,
    playerUid,
  ]);

  // Keep Spotify 30s preview <audio> in sync when phone audio is enabled
  useEffect(() => {
    const audioEl = spotifyAudioRef.current;
    if (!audioEl) return;
    if (!phoneAudioEnabled || room?.status !== 'playing' || !room?.currentMedia?.previewUrl) {
      audioEl.pause();
      return;
    }
    audioEl.play().catch(() => {});
  }, [phoneAudioEnabled, phoneAudioPlaySignal, room?.status, room?.currentMedia?.previewUrl]);

  const winnersCountByPattern = useMemo(() => {
    const map = new Map<WinningPattern, number>();
    for (const w of winners) {
      map.set(w.pattern, (map.get(w.pattern) || 0) + 1);
    }
    return map;
  }, [winners]);

  const playerWonPatterns = useMemo(() => {
    const set = new Set<WinningPattern>();
    for (const w of winners) {
      if (w.playerUid === playerUid) {
        set.add(w.pattern);
      }
    }
    return set;
  }, [winners, playerUid]);

  const readyPatterns = useMemo(() => {
    if (!room || !player) return [];
    return room.enabledPatterns.filter((p) => {
      if (playerWonPatterns.has(p)) return false;
      const ready = isClientTicketReadyForPattern(player.ticket, player.markedSongIds, p);
      const existingClaim = claims.find((c) => c.pattern === p);
      const alreadyClaimed =
        existingClaim && (existingClaim.status === 'pending' || existingClaim.status === 'approved');
      return ready && !alreadyClaimed;
    });
  }, [room, player, claims, playerWonPatterns]);

  const handleEnablePhoneAudio = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      }
    } catch {
      // Ignore
    }
    setPhoneAudioEnabled(true);
    setPhoneAudioPlaySignal((n) => n + 1);
    if (spotifyAudioRef.current && room?.currentMedia?.previewUrl && room?.status === 'playing') {
      spotifyAudioRef.current.play().catch(() => {});
    }
  };

  const handleToggleSong = async (songId: string) => {
    if (!room || !player || room.status === 'ended') return;
    setError('');
    try {
      await togglePlayerTicketMark(roomCode, playerUid, player.markedSongIds, songId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update ticket.');
    }
  };

  const handleSubmitClaim = async (pattern: WinningPattern) => {
    if (!room || !player) return;
    setClaimFeedback('');
    setSubmittingClaim(true);
    try {
      await submitWinnerClaim(room, player, pattern);
      setClaimFeedback(
        `${PATTERN_LABELS[pattern]} claim sent to ${room.hostName} for verification!`,
      );
      setClaimModalOpen(false);
    } catch (err) {
      setClaimFeedback(err instanceof Error ? err.message : 'Could not submit claim.');
    } finally {
      setSubmittingClaim(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-slate-300 flex items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
        <span>Connecting to Room {roomCode}...</span>
      </div>
    );
  }

  if (!room || !player) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
        <p className="text-rose-200">{error || 'Unable to load your room session.'}</p>
        <button
          type="button"
          onClick={onExitRoom}
          className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 cursor-pointer"
        >
          Back to Home
        </button>
      </div>
    );
  }

  const statusText =
    room.status === 'lobby'
      ? 'Waiting in Lobby'
      : room.status === 'playing'
        ? 'Music Playing'
        : room.status === 'paused'
          ? 'Paused'
          : 'Game Ended';

  const mediaSourceType = room.currentMedia?.sourceType || room.sourceType;
  const mediaSourceId = room.currentMedia?.sourceId || '';
  const mediaPreviewUrl = room.currentMedia?.previewUrl || '';

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 pb-24 space-y-6">
      {isOffline && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-200 flex items-center gap-2.5">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Internet connection lost. Reconnecting automatically when back online...</span>
        </div>
      )}

      {/* Room Status Header */}
      <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Host: {room.hostName}</span>
            <span aria-hidden="true">·</span>
            <span>Player: {player.name}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-indigo-300">{statusText}</span>
          </div>
          <h1 className="font-display text-2xl font-extrabold text-white">
            {room.gameName || 'Musical Housie'}
          </h1>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <div className="rounded-2xl border border-white/15 bg-[#090D1C] px-4 py-2 text-center">
            <div className="text-[11px] text-slate-400">Room Code</div>
            <div className="font-mono text-xl font-extrabold tracking-[0.2em] text-amber-300 tabular-nums">
              {room.roomCode}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {claimFeedback && (
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 flex items-center justify-between gap-3">
          <span>{claimFeedback}</span>
          <button
            type="button"
            onClick={() => setClaimFeedback('')}
            className="text-emerald-200 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Independent Winning Patterns & Live Winners */}
      {room.status !== 'lobby' && (
        <WinningPatternsBoard
          enabledPatterns={room.enabledPatterns}
          winners={winners}
          ticket={player.ticket}
          markedSongIds={player.markedSongIds}
          currentPlayerUid={player.uid}
        />
      )}

      {/* LOBBY WAITING SCREEN */}
      {room.status === 'lobby' && (
        <div className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 text-center space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <div className="space-y-2 max-w-md mx-auto">
            <h2 className="font-display text-2xl font-bold text-white">
              Waiting for {room.hostName} to start
            </h2>
            <p className="text-sm text-slate-300">
              Your unique 15-song Musical Housie ticket will appear here automatically as soon as the host starts the game.
            </p>
          </div>

          {room.playersSummary && room.playersSummary.length > 0 && (
            <div className="pt-2 border-t border-white/10">
              <p className="text-xs text-slate-400 mb-2">
                {room.playersSummary.length} player(s) in lobby
              </p>
              <p className="text-sm text-slate-200">
                {room.playersSummary.map((p) => p.name).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ACTIVE / ENDED PLAYER SCREEN */}
      {room.status !== 'lobby' && (
        <>
          {/* Live Match Notification Banner */}
          {matchAlert && (
            <div className="rounded-2xl border border-amber-300/70 bg-gradient-to-r from-amber-500/25 via-emerald-500/20 to-indigo-500/20 p-4 shadow-lg flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-slate-950 shrink-0">
                <BellRing className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-extrabold uppercase tracking-wide text-amber-300">
                  {matchAlert.autoTicked
                    ? 'Song on Your Ticket · Auto-Ticked!'
                    : 'Song Match Found on Your Ticket!'}
                </div>
                <div className="font-display text-base sm:text-lg font-extrabold text-white truncate">
                  {matchAlert.title}
                </div>
                <div className="text-xs text-slate-200 truncate">{matchAlert.artist}</div>
              </div>
            </div>
          )}

          {/* Ready Pattern Alert */}
          {readyPatterns.length > 0 && room.status !== 'ended' && (
            <button
              type="button"
              onClick={() => {
                setClaimFeedback('');
                setClaimModalOpen(true);
              }}
              className="w-full rounded-2xl border border-emerald-400/60 bg-emerald-500/20 px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-emerald-500/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5 text-emerald-300 shrink-0" />
                <div className="text-xs sm:text-sm font-bold text-white">
                  Winning pattern ready: {readyPatterns.map((p) => PATTERN_LABELS[p]).join(', ')}
                </div>
              </div>
              <span className="rounded-lg bg-emerald-400 px-3 py-1 text-xs font-extrabold text-slate-950 shrink-0">
                Claim Now
              </span>
            </button>
          )}

          {/* Phone Audio + Visualizer Card */}
          <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-sm font-bold text-indigo-300 tabular-nums">
                Song #{room.currentSongNumber} of {room.totalSongs}
              </span>
              <span className="font-mono text-xs text-slate-300 tabular-nums">
                {player.markedSongIds.length} / 15 marked on ticket
              </span>
            </div>

            <MusicVisualizer isPlaying={room.status === 'playing'} compact />

            {/* Phone Sound Controls (Essential for iPhone Safari & Remote Players) */}
            {room.status !== 'ended' && mediaSourceId && (
              <div className="rounded-2xl border border-white/10 bg-[#090D1C] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-slate-200">
                    {phoneAudioEnabled ? (
                      <Volume2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-slate-400 shrink-0" />
                    )}
                    <span className="font-semibold">
                      {phoneAudioEnabled ? 'Phone Audio Enabled' : 'Listen on This Phone'}
                    </span>
                  </div>

                  {!phoneAudioEnabled ? (
                    <button
                      type="button"
                      onClick={handleEnablePhoneAudio}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                      <span>Tap to Hear Song</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      {room.status === 'playing' && !phonePlayerActive && mediaSourceType === 'youtube' && (
                        <button
                          type="button"
                          onClick={handleEnablePhoneAudio}
                          className="rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
                        >
                          Tap Play Audio
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPhoneAudioEnabled(false)}
                        className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                      >
                        Mute Phone
                      </button>
                    </div>
                  )}
                </div>

                {phoneAudioEnabled && mediaSourceType === 'youtube' && (
                  <div className="relative overflow-hidden rounded-xl border border-white/10">
                    <YouTubePlayer
                      videoId={mediaSourceId}
                      isPlaying={room.status === 'playing'}
                      playSignal={phoneAudioPlaySignal}
                      onPlaybackProgress={(info) => setPhonePlayerActive(info.playerPlaying)}
                      caption="Audio plays directly on your phone via the official YouTube player."
                    />
                    {!room.currentSongRevealed && (
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-[#090D1C] via-[#090D1C]/95 to-transparent flex items-center px-3">
                        <span className="text-xs font-semibold text-indigo-200">
                          Mystery Song Audio Playing (Title hidden until revealed)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {phoneAudioEnabled && mediaSourceType === 'spotify' && (
                  mediaPreviewUrl ? (
                    <div className="space-y-1.5">
                      <audio
                        ref={spotifyAudioRef}
                        src={mediaPreviewUrl}
                        controls
                        playsInline
                        className="w-full h-10"
                      />
                      <p className="text-[11px] text-slate-400">
                        Playing Spotify preview clip on your phone.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      This Spotify track plays from the host&apos;s speaker (no 30s preview URL provided by Spotify). Matching songs on your ticket still notify and auto-tick automatically.
                    </p>
                  )
                )}
              </div>
            )}

            {room.currentSongRevealed && room.revealedCurrentSong?.title ? (
              <div className="rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-3">
                <div className="text-xs font-semibold text-emerald-300">Host Revealed Song</div>
                <div className="text-base font-bold text-white mt-0.5">
                  {room.revealedCurrentSong.title}
                </div>
                <div className="text-xs text-slate-300">{room.revealedCurrentSong.artist}</div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-[#090D1C] px-4 py-3 text-sm text-slate-300">
                {room.status === 'ended'
                  ? 'Game has ended. Thank you for playing!'
                  : 'Songs matching your ticket notify you and auto-tick automatically (or tap any song manually).'}
              </div>
            )}
          </div>

          {/* Interactive 3x5 Ticket */}
          <div className="rounded-3xl border border-white/10 bg-[#121830] p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="font-display text-lg sm:text-xl font-bold text-white">
                    Your Musical Housie Ticket
                  </h2>
                  {player.ticketNumber > 0 && (
                    <span className="rounded-lg border border-amber-400/40 bg-amber-400/15 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-200 tabular-nums">
                      Ticket {formatTicketNumber(player.ticketNumber)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-400">
                  {autoTickEnabled
                    ? 'Auto-tick is ON for matching songs · tap anytime to adjust'
                    : 'Tap a song on your ticket to mark or unmark'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setAutoTickEnabled((prev) => !prev)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  autoTickEnabled
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                    : 'border-white/15 bg-white/5 text-slate-300'
                }`}
              >
                Auto-Tick: {autoTickEnabled ? 'On' : 'Off'}
              </button>
            </div>

            <HousieTicket
              ticket={player.ticket}
              markedSongIds={player.markedSongIds}
              activeMatchSongId={activeMatchCell?.id || ''}
              onToggleSong={handleToggleSong}
              disabled={room.status === 'ended'}
            />
          </div>

          {/* Player's Submitted Claims */}
          {claims.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#121830] p-4 space-y-2">
              <h3 className="text-sm font-bold text-white">Your Claims</h3>
              <div className="divide-y divide-white/10">
                {claims.map((c) => (
                  <div key={c.id} className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                    <span className="font-semibold text-slate-100">
                      {PATTERN_LABELS[c.pattern]}
                    </span>
                    <span
                      className={
                        c.status === 'approved'
                          ? 'text-emerald-300 font-semibold'
                          : c.status === 'rejected'
                            ? 'text-rose-300'
                            : 'text-amber-300'
                      }
                    >
                      {c.status === 'pending'
                        ? 'Pending host verification...'
                        : c.verificationSummary || c.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Previously Revealed Songs */}
          {room.revealedSongs && room.revealedSongs.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-[#121830] p-4 space-y-2.5">
              <h3 className="text-sm font-bold text-white">
                Previously Played &amp; Revealed Songs ({room.revealedSongs.length})
              </h3>
              <div className="max-h-44 overflow-y-auto divide-y divide-white/5">
                {room.revealedSongs.map((s, idx) => (
                  <div key={s.id} className="py-1.5 flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-200 truncate">
                      {idx + 1}. {s.title}
                    </span>
                    <span className="text-slate-400 truncate max-w-[130px] shrink-0">
                      {s.artist}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Primary Claim Win CTA */}
          {room.status !== 'ended' && (
            <div className="sticky bottom-4 z-20">
              {room.enabledPatterns.every((p) => playerWonPatterns.has(p)) ? (
                <div className="w-full flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/35 bg-[#10162D]/95 px-6 py-4 text-sm font-bold text-emerald-200 shadow-2xl shadow-black/60">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>You Won All Enabled Patterns!</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setClaimFeedback('');
                    setClaimModalOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-amber-400 px-6 py-4 text-base font-extrabold text-slate-950 shadow-2xl shadow-black/60 hover:bg-amber-300 active:scale-[0.99] transition-all cursor-pointer"
                >
                  <Award className="h-5 w-5" />
                  <span>CLAIM WIN</span>
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Pattern Claim Modal */}
      {claimModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="claim-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#10162D] p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="claim-modal-title" className="font-display text-xl font-extrabold text-white">
                  Claim a Winning Pattern
                </h2>
                <p className="text-xs text-slate-300 mt-1">
                  Claim any completed pattern in any order. You can win multiple different patterns once each.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClaimModalOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2.5 max-h-[65vh] overflow-y-auto pr-1">
              {ALL_PATTERNS.filter((p) => room.enabledPatterns.includes(p)).map((pattern) => {
                const playerAlreadyWon = playerWonPatterns.has(pattern);
                const patternWinnerCount = winnersCountByPattern.get(pattern) || 0;
                const ready = isClientTicketReadyForPattern(
                  player.ticket,
                  player.markedSongIds,
                  pattern,
                );
                const progress = getPatternProgress(player.ticket, player.markedSongIds, pattern);
                const existingClaim = claims.find((c) => c.pattern === pattern);
                const alreadyClaimed =
                  existingClaim &&
                  (existingClaim.status === 'pending' || existingClaim.status === 'approved');

                return (
                  <button
                    key={pattern}
                    type="button"
                    disabled={playerAlreadyWon || !ready || Boolean(alreadyClaimed) || submittingClaim}
                    onClick={() => handleSubmitClaim(pattern)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      playerAlreadyWon
                        ? 'border-emerald-400/40 bg-emerald-500/12 opacity-90 cursor-not-allowed'
                        : alreadyClaimed
                          ? 'border-indigo-400/35 bg-indigo-500/10 opacity-80 cursor-not-allowed'
                          : ready
                            ? 'border-amber-400/60 bg-amber-400/15 hover:bg-amber-400/25 cursor-pointer'
                            : 'border-white/10 bg-[#090D1C] opacity-65 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold text-white">
                        {PATTERN_LABELS[pattern]}
                      </span>
                      {playerAlreadyWon ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>You Won</span>
                        </span>
                      ) : alreadyClaimed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="capitalize">{existingClaim.status}</span>
                        </span>
                      ) : ready ? (
                        <span className="text-xs font-bold text-amber-300">Ready to Claim</span>
                      ) : (
                        <span className="font-mono text-xs text-slate-400 tabular-nums">
                          {progress.matched}/{progress.required}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      {playerAlreadyWon
                        ? 'Already won on your ticket in this game session.'
                        : `${PATTERN_DESCRIPTIONS[pattern]}${
                            patternWinnerCount > 0
                              ? ` · ${patternWinnerCount} ${patternWinnerCount === 1 ? 'winner' : 'winners'} so far (Still Open)`
                              : ''
                          }`}
                    </p>
                  </button>
                );
              })}
            </div>

            {claimFeedback && (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
                {claimFeedback}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
