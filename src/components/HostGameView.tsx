import confetti from 'canvas-confetti';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  QrCode,
  Shuffle,
  SkipForward,
  Square,
  StopCircle,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceToNextSong,
  cleanupExpiredOrEndedHostedRooms,
  deleteRoomData,
  endGameRoom,
  isFirestoreQuotaError,
  resolveWinnerClaim,
  revealCurrentSongToPlayers,
  savePlaylistToRoom,
  setRoomPlaybackStatus,
  startGameAndDealTickets,
  subscribeToClaimsForHost,
  subscribeToHostSecret,
  subscribeToRoom,
  subscribeToRoomPlayersForHost,
  subscribeToRoomWinners,
  syncPlayersSummary,
  toggleRandomModeLive,
  updateLobbySettings,
  verifyClaimOnServer,
} from '../services/gameService.ts';
import { formatTicketNumber, verifyClaimAgainstPlayedSongs } from '../shared/gameLogic.ts';
import {
  ALL_PATTERNS,
  ClaimVerificationResult,
  HostSecretState,
  PATTERN_LABELS,
  PlayerData,
  ProblemTrackItem,
  RoomData,
  WinnerClaim,
  WinnerRecord,
  WinningPattern,
} from '../shared/types.ts';
import { GlobalBranding } from './GlobalBranding.tsx';
import { MusicVisualizer } from './MusicVisualizer.tsx';
import { PlaylistSelector } from './PlaylistSelector.tsx';
import { WinningPatternsBoard } from './WinningPatternsBoard.tsx';
import { PlaybackProgressInfo, YouTubePlayer } from './YouTubePlayer.tsx';

interface HostGameViewProps {
  roomCode: string;
  hostUid: string;
  onExitRoom: () => void;
}

export function HostGameView({ roomCode, hostUid, onExitRoom }: HostGameViewProps) {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [secret, setSecret] = useState<HostSecretState | null>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [claims, setClaims] = useState<WinnerClaim[]>([]);
  const [winners, setWinners] = useState<WinnerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrUseSharedOrigin, setQrUseSharedOrigin] = useState(false);
  const qrContainerRef = useRef<HTMLDivElement | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [activePanel, setActivePanel] = useState<'claims' | 'players' | 'played'>('claims');

  const [verifications, setVerifications] = useState<Record<string, ClaimVerificationResult>>({});
  const [verifyingIds, setVerifyingIds] = useState<Record<string, boolean>>({});
  const processingQueueRef = useRef(false);
  const attemptedAutoResolveRef = useRef<Set<string>>(new Set());
  const prevWinnersCountRef = useRef(0);

  const [clipDurationSeconds, setClipDurationSeconds] = useState<number | null>(45);
  const [playSignal, setPlaySignal] = useState(0);
  const [stopSignal, setStopSignal] = useState(0);
  const [autoStopNotice, setAutoStopNotice] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState<PlaybackProgressInfo>({
    songElapsedSeconds: 0,
    isAdPlaying: false,
    playerPlaying: false,
  });
  const [currentSongError, setCurrentSongError] = useState<ProblemTrackItem | null>(null);
  const [playbackProblems, setPlaybackProblems] = useState<ProblemTrackItem[]>([]);

  useEffect(() => {
    const unsubRoom = subscribeToRoom(
      roomCode,
      (data) => {
        setRoom(data);
        setLoading(false);
        if (!data) {
          setError('This game room no longer exists.');
        }
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    const unsubSecret = subscribeToHostSecret(
      roomCode,
      (data) => setSecret(data),
      (err) => setError(err.message),
    );

    const unsubPlayers = subscribeToRoomPlayersForHost(
      roomCode,
      hostUid,
      (list) => setPlayers(list),
      (err) => setError(err.message),
    );

    const unsubClaims = subscribeToClaimsForHost(
      roomCode,
      hostUid,
      (list) => setClaims(list),
      (err) => setError(err.message),
    );

    const unsubWinners = subscribeToRoomWinners(
      roomCode,
      (list) => setWinners(list),
      (err) => setError(err.message),
    );

    return () => {
      unsubRoom();
      unsubSecret();
      unsubPlayers();
      unsubClaims();
      unsubWinners();
    };
  }, [roomCode, hostUid]);

  // Sync playersSummary onto public room doc when players join or update
  const lastSummarySigRef = useRef('');
  useEffect(() => {
    if (!room || room.status === 'ended') return;
    const sig = players
      .map((p) => `${p.uid}:${p.name}:${p.isOnline}`)
      .sort()
      .join('|');
    if (sig !== lastSummarySigRef.current) {
      lastSummarySigRef.current = sig;
      syncPlayersSummary(roomCode, players).catch(() => {});
    }
  }, [players, room, roomCode]);

  // Reset auto-resolve tracking if a rejected claim is resubmitted back to pending
  useEffect(() => {
    for (const claim of claims) {
      if (claim.status !== 'pending') {
        attemptedAutoResolveRef.current.delete(claim.id);
      }
    }
  }, [claims]);

  // Chronological server-side claim verification & automatic winner declaration
  useEffect(() => {
    if (!room || room.status === 'ended' || processingQueueRef.current) return;

    const getClaimTimeMs = (c: WinnerClaim) => {
      const created = c.createdAt as { toMillis?: () => number } | undefined;
      if (created && typeof created.toMillis === 'function') {
        return created.toMillis();
      }
      return c.claimedAtMs || 0;
    };

    const pendingSorted = claims
      .filter((c) => c.status === 'pending' && !attemptedAutoResolveRef.current.has(c.id))
      .sort((a, b) => getClaimTimeMs(a) - getClaimTimeMs(b) || a.id.localeCompare(b.id));

    if (pendingSorted.length === 0) return;

    let cancelled = false;
    processingQueueRef.current = true;

    const processNextBatch = async () => {
      try {
        for (const claim of pendingSorted) {
          if (cancelled) break;
          attemptedAutoResolveRef.current.add(claim.id);
          setVerifyingIds((prev) => ({ ...prev, [claim.id]: true }));
          try {
            const result = await verifyClaimOnServer(roomCode, claim.id);
            setVerifications((prev) => ({ ...prev, [claim.id]: result }));
            await resolveWinnerClaim({
              room,
              claim,
              approve: result.isValid,
              verification: result,
            });
          } catch {
            // Leave claim in pending state with local breakdown so host can manually retry/resolve
            if (secret) {
              const targetPlayer = players.find((p) => p.uid === claim.playerUid);
              const fallback = verifyClaimAgainstPlayedSongs(
                targetPlayer?.ticket || claim.ticketSnapshot,
                claim.claimedSongIds,
                secret.playedSongIds,
                claim.pattern,
              );
              setVerifications((prev) => ({ ...prev, [claim.id]: fallback }));
            }
          } finally {
            setVerifyingIds((prev) => ({ ...prev, [claim.id]: false }));
          }
        }
      } finally {
        processingQueueRef.current = false;
      }
    };

    processNextBatch();

    return () => {
      cancelled = true;
    };
  }, [claims, room, roomCode, secret, players]);

  // Celebrate newly declared winners
  useEffect(() => {
    const count = winners.length;
    if (count > prevWinnersCountRef.current) {
      confetti({ particleCount: 70, spread: 65, origin: { y: 0.65 } });
    }
    prevWinnersCountRef.current = count;
  }, [winners.length]);

  const currentTrack = useMemo(() => {
    if (!secret || !secret.currentSongId) return null;
    return secret.tracks.find((t) => t.id === secret.currentSongId) || null;
  }, [secret]);

  const playedTracks = useMemo(() => {
    if (!secret) return [];
    const map = new Map(secret.tracks.map((t) => [t.id, t]));
    return secret.playedSongIds.map((id) => map.get(id)).filter(Boolean);
  }, [secret]);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const sharedOrigin = currentOrigin.replace('://ais-dev-', '://ais-pre-');
  const hasSeparateSharedOrigin = Boolean(currentOrigin && sharedOrigin !== currentOrigin);
  const inviteUrl = currentOrigin ? `${currentOrigin}/?room=${roomCode}` : '';
  const sharedInviteUrl = sharedOrigin ? `${sharedOrigin}/?room=${roomCode}` : '';
  const qrInviteUrl =
    hasSeparateSharedOrigin && qrUseSharedOrigin ? sharedInviteUrl : inviteUrl;

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `Join my Musical Housie game! Room Code: ${roomCode} — Open ${qrInviteUrl}`,
  )}`;

  const copyTextSafely = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback for iOS Safari / WebKit when Clipboard API rejects
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyCode = async () => {
    const ok = await copyTextSafely(roomCode);
    if (ok) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    }
  };

  const handleCopyLink = async () => {
    const ok = await copyTextSafely(qrInviteUrl);
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    }
  };

  const handleDownloadQr = () => {
    const svgEl = qrContainerRef.current?.querySelector('svg');
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const size = 600;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const pngUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `musical-housie-${roomCode}-qr.png`;
        link.click();
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleTogglePattern = async (pattern: WinningPattern) => {
    if (!room || room.status !== 'lobby') return;
    const exists = room.enabledPatterns.includes(pattern);
    if (exists && room.enabledPatterns.length === 1) {
      setError('Keep at least one winning pattern enabled.');
      return;
    }
    setError('');
    const next = exists
      ? room.enabledPatterns.filter((p) => p !== pattern)
      : [...room.enabledPatterns, pattern];
    await updateLobbySettings(roomCode, next, room.randomMode);
  };

  const handleStartGame = async () => {
    if (!room || !secret) return;
    setError('');
    setActionBusy(true);
    try {
      await startGameAndDealTickets({
        roomCode,
        hostUid,
        players,
        tracks: secret.tracks,
        enabledPatterns: room.enabledPatterns,
        randomMode: room.randomMode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start game.');
    } finally {
      setActionBusy(false);
    }
  };

  const handlePlayPause = async (target: 'playing' | 'paused') => {
    if (!room) return;
    setError('');
    setAutoStopNotice(false);
    if (target === 'playing') {
      setPlaySignal((s) => s + 1);
    }
    if (room.status !== target) {
      await setRoomPlaybackStatus(roomCode, target);
    }
  };

  const handleStopSong = async () => {
    if (!room) return;
    setError('');
    setAutoStopNotice(false);
    setStopSignal((s) => s + 1);
    if (room.status !== 'paused') {
      await setRoomPlaybackStatus(roomCode, 'paused');
    }
  };

  const handleAutoStop = async () => {
    if (!room || room.status === 'ended') return;
    setAutoStopNotice(true);
    if (room.status !== 'paused') {
      await setRoomPlaybackStatus(roomCode, 'paused');
    }
  };

  const handleExtendClip = async () => {
    if (!room) return;
    setAutoStopNotice(false);
    setClipDurationSeconds((prev) => (prev ? prev + 15 : 45));
    setPlaySignal((s) => s + 1);
    if (room.status !== 'playing') {
      await setRoomPlaybackStatus(roomCode, 'playing');
    }
  };

  const handleNextSong = async () => {
    if (!room || !secret) return;
    setError('');
    setCurrentSongError(null);
    setAutoStopNotice(false);
    setActionBusy(true);
    try {
      const res = await advanceToNextSong(roomCode, room, secret);
      if (res.finishedPlaylist) {
        setError('All songs in this playlist have been played! You can verify any remaining claims or end the game.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not advance to next song.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRevealSong = async () => {
    if (!room || !currentTrack) return;
    setError('');
    await revealCurrentSongToPlayers(roomCode, room, currentTrack);
  };

  const handleToggleRandomMode = async () => {
    if (!room || !secret) return;
    const nextRandom = !room.randomMode;
    if (room.status === 'lobby') {
      await updateLobbySettings(roomCode, room.enabledPatterns, nextRandom);
    } else {
      await toggleRandomModeLive(roomCode, secret, nextRandom);
    }
  };

  const handleEndGame = async () => {
    if (!room) return;
    setActionBusy(true);
    try {
      await endGameRoom(roomCode, room, currentTrack);
      setConfirmEnd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end game.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteAndExit = async () => {
    setActionBusy(true);
    setError('');
    try {
      await deleteRoomData(roomCode);
      onExitRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete room data.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleFreeOldRooms = async () => {
    setActionBusy(true);
    try {
      const removed = await cleanupExpiredOrEndedHostedRooms({
        includeAllForHost: true,
        excludeRoomCode: roomCode,
      });
      setError(
        removed > 0
          ? `Cleared ${removed} old room(s) from Firebase.`
          : 'No older rooms found to delete for this browser.',
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleResolveClaim = async (claim: WinnerClaim, approve: boolean) => {
    if (!room) return;
    setError('');
    setActionBusy(true);
    try {
      const verification =
        verifications[claim.id] || (await verifyClaimOnServer(roomCode, claim.id));
      setVerifications((prev) => ({ ...prev, [claim.id]: verification }));
      await resolveWinnerClaim({
        room,
        claim,
        approve,
        verification,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update claim.');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-slate-300 flex items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
        <span>Loading Host Dashboard...</span>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
        <p className="text-rose-200">{error || 'Room not found.'}</p>
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

  const pendingClaimsCount = claims.filter((c) => c.status === 'pending').length;
  const totalSongs = room.totalSongs || secret?.tracks.length || 0;
  const playedCount = secret?.playedSongIds.length || 0;
  const remainingCount = Math.max(0, totalSongs - playedCount);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Top Room Summary Bar */}
      <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-2.5">
          <GlobalBranding variant="bar" />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Host: {room.hostName}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">Status: {room.status}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{players.length} Players</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
            {room.gameName || 'Musical Housie Night'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="rounded-2xl border border-amber-400/35 bg-[#090D1C] px-4 py-2 text-center">
            <div className="text-[11px] font-medium text-slate-400">Room Code</div>
            <div className="font-mono text-2xl font-extrabold tracking-[0.2em] text-amber-300 tabular-nums">
              {room.roomCode}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            {copiedCode ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            {copiedLink ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            <span>{copiedLink ? 'Link Copied' : 'Invite Link'}</span>
          </button>

          <button
            type="button"
            onClick={() => setQrModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-3.5 py-2.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25 transition-colors cursor-pointer"
          >
            <QrCode className="h-4 w-4" />
            <span>QR Code</span>
          </button>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3.5 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-colors"
          >
            <MessageCircle className="h-4 w-4" />
            <span>WhatsApp</span>
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200 flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          {isFirestoreQuotaError(error) && (
            <button
              type="button"
              onClick={handleFreeOldRooms}
              disabled={actionBusy}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 cursor-pointer shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Free Firebase Database</span>
            </button>
          )}
        </div>
      )}

      {/* Independent Winning Patterns & Chronological Winners */}
      {room.status !== 'lobby' && (
        <WinningPatternsBoard
          enabledPatterns={room.enabledPatterns}
          winners={winners}
        />
      )}

      {/* LOBBY VIEW */}
      {room.status === 'lobby' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            <PlaylistSelector
              roomCode={roomCode}
              initialSourceType={room.sourceType}
              initialUrl={room.playlistUrl}
              initialPlaylistName={room.playlistName}
              tracks={secret?.tracks || []}
              onPlaylistLoaded={async ({ sourceType, playlistName, playlistUrl, tracks }) => {
                await savePlaylistToRoom({
                  roomCode,
                  hostUid,
                  sourceType,
                  playlistName,
                  playlistUrl,
                  tracks,
                  enabledPatterns: room.enabledPatterns,
                  randomMode: room.randomMode,
                });
              }}
            />

            <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-white">Winning Patterns</h2>
                  <p className="text-xs text-slate-400">
                    Choose active patterns. All selected patterns run independently in any order with multiple winners.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleRandomMode}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    room.randomMode
                      ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                      : 'border-white/15 bg-white/5 text-slate-300'
                  }`}
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  <span>Random Mode: {room.randomMode ? 'On' : 'Off'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {ALL_PATTERNS.map((pattern) => {
                  const enabled = room.enabledPatterns.includes(pattern);
                  return (
                    <button
                      key={pattern}
                      type="button"
                      onClick={() => handleTogglePattern(pattern)}
                      className={`rounded-xl border px-3.5 py-2.5 text-left text-xs font-semibold transition-colors cursor-pointer ${
                        enabled
                          ? 'border-amber-400/60 bg-amber-400/15 text-amber-200'
                          : 'border-white/10 bg-[#090D1C] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {PATTERN_LABELS[pattern]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-white">Joined Players</h2>
                <span className="font-mono text-sm font-bold text-indigo-300 tabular-nums">
                  {players.length}
                </span>
              </div>

              {players.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-[#090D1C] p-6 text-center space-y-3 text-sm text-slate-400">
                  <p>
                    Share room code <strong className="font-mono text-amber-300">{roomCode}</strong> with friends. Players will appear here as they join.
                  </p>
                  <button
                    type="button"
                    onClick={() => setQrModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-400/40 bg-indigo-500/15 px-4 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25 transition-colors cursor-pointer"
                  >
                    <QrCode className="h-4 w-4" />
                    <span>Show Join QR Code</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-white/10 max-h-64 overflow-y-auto">
                  {players.map((p) => (
                    <div key={p.uid} className="py-2.5 flex items-center justify-between text-sm">
                      <span className="font-medium text-white">{p.name}</span>
                      <span
                        className={`text-xs ${p.isOnline ? 'text-emerald-300' : 'text-slate-500'}`}
                      >
                        {p.isOnline ? 'Connected' : 'Offline'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 space-y-2.5">
                <button
                  type="button"
                  onClick={handleStartGame}
                  disabled={
                    actionBusy || (secret?.tracks.length || 0) < 15 || players.length === 0
                  }
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-6 py-4 text-base font-extrabold text-slate-950 hover:bg-amber-300 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {actionBusy ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Dealing Tickets...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5 fill-slate-950" />
                      <span>START GAME &amp; DEAL TICKETS</span>
                    </>
                  )}
                </button>
                {((secret?.tracks.length || 0) < 15 || players.length === 0) && (
                  <p className="text-xs text-center text-slate-400">
                    {(secret?.tracks.length || 0) < 15
                      ? 'Load a playlist with at least 15 accessible songs first.'
                      : 'Waiting for at least 1 player to join.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE / ENDED GAME DASHBOARD */}
      {room.status !== 'lobby' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Current Song + Player + Big Host Controls */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 sm:p-6 space-y-5">
              {/* Song Counters */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-2xl bg-[#090D1C] border border-white/10 p-3">
                  <div className="text-xs text-slate-400">Current Song</div>
                  <div className="font-mono text-xl font-bold text-white tabular-nums mt-0.5">
                    {room.currentSongNumber} / {totalSongs}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#090D1C] border border-white/10 p-3">
                  <div className="text-xs text-slate-400">Played</div>
                  <div className="font-mono text-xl font-bold text-emerald-300 tabular-nums mt-0.5">
                    {playedCount}
                  </div>
                </div>
                <div className="rounded-2xl bg-[#090D1C] border border-white/10 p-3">
                  <div className="text-xs text-slate-400">Remaining</div>
                  <div className="font-mono text-xl font-bold text-amber-300 tabular-nums mt-0.5">
                    {remainingCount}
                  </div>
                </div>
              </div>

              {/* Host-Only Current Song Display */}
              <div className="rounded-2xl border border-indigo-400/30 bg-[#090D1C] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span>Current Song (Host Only)</span>
                  <span>
                    {room.currentSongRevealed ? 'Revealed to players' : 'Hidden from players'}
                  </span>
                </div>
                {currentTrack ? (
                  <div>
                    <div className="font-display text-xl sm:text-2xl font-extrabold text-white leading-snug">
                      {currentTrack.title}
                    </div>
                    <div className="text-sm text-indigo-300 mt-0.5">{currentTrack.artist}</div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">No active song loaded.</div>
                )}

                <MusicVisualizer isPlaying={room.status === 'playing' || playbackProgress.playerPlaying} />

                {/* Ad-Safe Song Timer & Auto-Stop Selector */}
                {room.status !== 'ended' && (
                  <div className="rounded-xl border border-white/10 bg-[#121830] p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                        <span className="text-slate-300 font-medium">Song Play Time:</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          {Math.floor(playbackProgress.songElapsedSeconds / 60)}:
                          {String(playbackProgress.songElapsedSeconds % 60).padStart(2, '0')}
                          {clipDurationSeconds ? ` / 0:${String(clipDurationSeconds).padStart(2, '0')}` : ''}
                        </span>
                        {playbackProgress.isAdPlaying && (
                          <span className="rounded-md bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                            Ad playing · timer paused
                          </span>
                        )}
                      </div>

                      {clipDurationSeconds && (
                        <button
                          type="button"
                          onClick={handleExtendClip}
                          className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10 cursor-pointer"
                        >
                          +15s More
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400 mr-1">Auto-Stop Clip:</span>
                      {[40, 45, 50, 60, null].map((sec) => {
                        const active = clipDurationSeconds === sec;
                        return (
                          <button
                            key={sec ?? 'full'}
                            type="button"
                            onClick={() => {
                              setAutoStopNotice(false);
                              setClipDurationSeconds(sec);
                            }}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                              active
                                ? 'bg-amber-400 text-slate-950'
                                : 'bg-[#090D1C] border border-white/10 text-slate-300 hover:text-white'
                            }`}
                          >
                            {sec ? `${sec}s` : 'Full Song'}
                          </button>
                        );
                      })}
                    </div>

                    {autoStopNotice && clipDurationSeconds && (
                      <div className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                        Stopped after {clipDurationSeconds}s of song playback. Click <strong>NEXT SONG</strong> for the next track or <strong>PLAY</strong> to continue this song.
                      </div>
                    )}
                  </div>
                )}

                {currentTrack && room.status !== 'ended' && (
                  <div className="pt-1 space-y-3">
                    {currentSongError && currentSongError.sourceId === currentTrack.sourceId && (
                      <div className="rounded-xl border border-rose-400/50 bg-rose-500/15 p-3.5 space-y-2.5 text-xs">
                        <div className="flex items-start gap-2 text-rose-100">
                          <AlertTriangle className="h-4 w-4 text-rose-300 shrink-0 mt-0.5" />
                          <div className="space-y-0.5 min-w-0">
                            <p className="font-bold text-white">
                              Problem Song (#{currentSongError.position}): {currentSongError.title}
                            </p>
                            <p className="text-rose-200">
                              {currentSongError.artist} · {currentSongError.reason}
                            </p>
                            <p className="text-rose-100/90">
                              Skip to the next song now, and remove this video from your YouTube playlist before the next game.
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={`https://www.youtube.com/watch?v=${encodeURIComponent(currentSongError.sourceId)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
                          >
                            <span>Open Video on YouTube</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          {remainingCount > 0 && (
                            <button
                              type="button"
                              onClick={handleNextSong}
                              disabled={actionBusy}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-400 px-3 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
                            >
                              <SkipForward className="h-3.5 w-3.5" />
                              <span>Skip to Next Song</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <YouTubePlayer
                      videoId={currentTrack.sourceId}
                      isPlaying={room.status === 'playing'}
                      playSignal={playSignal}
                      stopSignal={stopSignal}
                      clipDurationSeconds={clipDurationSeconds}
                      onTrackEnded={handleNextSong}
                      onAutoStop={handleAutoStop}
                      onPlaybackError={(msg) => {
                        const problem: ProblemTrackItem = {
                          position: room.currentSongNumber,
                          sourceId: currentTrack.sourceId,
                          title: currentTrack.title,
                          artist: currentTrack.artist,
                          reason: msg,
                        };
                        setCurrentSongError(problem);
                        setPlaybackProblems((prev) =>
                          prev.some((p) => p.sourceId === problem.sourceId)
                            ? prev
                            : [...prev, problem],
                        );
                        setError(
                          `Problem playing Song #${room.currentSongNumber} "${currentTrack.title}" — ${msg}`,
                        );
                      }}
                      onStateSync={(playing) => {
                        const target = playing ? 'playing' : 'paused';
                        if (room.status !== target && room.status !== 'ended') {
                          setRoomPlaybackStatus(roomCode, target).catch(() => {});
                        }
                      }}
                      onPlaybackProgress={setPlaybackProgress}
                    />
                  </div>
                )}
              </div>

              {/* Large Host Playback Controls */}
              {room.status !== 'ended' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    <button
                      type="button"
                      onClick={() => handlePlayPause('playing')}
                      disabled={(room.status === 'playing' && playbackProgress.playerPlaying) || actionBusy}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 py-4 text-sm font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-45 cursor-pointer"
                    >
                      <Play className="h-5 w-5 fill-slate-950 shrink-0" />
                      <span>PLAY</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handlePlayPause('paused')}
                      disabled={(room.status === 'paused' && !playbackProgress.playerPlaying) || actionBusy}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 px-3 py-4 text-sm font-extrabold text-white hover:bg-indigo-400 disabled:opacity-45 cursor-pointer"
                    >
                      <Pause className="h-5 w-5 shrink-0" />
                      <span>PAUSE</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleStopSong}
                      disabled={actionBusy || !currentTrack}
                      className="flex items-center justify-center gap-2 rounded-2xl border border-amber-400/50 bg-amber-500/15 px-3 py-4 text-sm font-extrabold text-amber-200 hover:bg-amber-500/25 disabled:opacity-45 cursor-pointer"
                    >
                      <StopCircle className="h-5 w-5 shrink-0" />
                      <span>STOP</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleNextSong}
                      disabled={actionBusy || remainingCount === 0}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-3 py-4 text-sm font-extrabold text-slate-950 hover:bg-amber-300 disabled:opacity-45 cursor-pointer"
                    >
                      <SkipForward className="h-5 w-5 shrink-0" />
                      <span>NEXT</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfirmEnd(true)}
                      disabled={actionBusy}
                      className="col-span-2 sm:col-span-1 flex items-center justify-center gap-2 rounded-2xl border border-rose-400/40 bg-rose-500/15 px-3 py-4 text-sm font-extrabold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                    >
                      <Square className="h-4 w-4 fill-rose-200 shrink-0" />
                      <span>END</span>
                    </button>
                  </div>

                  {confirmEnd && (
                    <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <span className="text-sm text-rose-100">
                        End this game for all players? Final winners will stay visible.
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmEnd(false)}
                          className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleEndGame}
                          className="rounded-xl bg-rose-500 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-400 cursor-pointer"
                        >
                          Confirm End
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Secondary Controls */}
                  <div className="flex flex-wrap gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleRevealSong}
                      disabled={!currentTrack || room.currentSongRevealed}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-45 cursor-pointer"
                    >
                      {room.currentSongRevealed ? (
                        <>
                          <EyeOff className="h-4 w-4 text-emerald-300" />
                          <span>Song Revealed</span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-4 w-4 text-amber-300" />
                          <span>Reveal Current Song</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleRandomMode}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold cursor-pointer ${
                        room.randomMode
                          ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                          : 'border-white/15 bg-white/5 text-slate-300'
                      }`}
                    >
                      <Shuffle className="h-4 w-4" />
                      <span>Random Song Mode: {room.randomMode ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-[#090D1C] p-5 text-center space-y-3">
                  <p className="font-display text-lg font-bold text-white">Game Ended</p>
                  <p className="text-xs text-slate-400">
                    When players have finished viewing winners, close &amp; delete this room to free Firebase database space.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleDeleteAndExit}
                      disabled={actionBusy}
                      className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Close &amp; Free Database</span>
                    </button>
                    <button
                      type="button"
                      onClick={onExitRoom}
                      className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
                    >
                      Return Home
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Claims, Players, Played Songs */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-3xl border border-white/10 bg-[#121830] p-5 space-y-4">
              <div className="flex items-center gap-1 rounded-xl bg-[#090D1C] p-1 border border-white/10">
                <button
                  type="button"
                  onClick={() => setActivePanel('claims')}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    activePanel === 'claims'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Claims ({pendingClaimsCount} pending)
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('players')}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    activePanel === 'players'
                      ? 'bg-indigo-500 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Players ({players.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('played')}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    activePanel === 'played'
                      ? 'bg-indigo-500 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Played ({playedTracks.length})
                </button>
              </div>

              {activePanel === 'claims' && (
                <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                  {claims.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/15 bg-[#090D1C] p-6 text-center text-sm text-slate-400">
                      No winner claims yet. When a player taps Claim Win, it appears here with automatic server verification.
                    </div>
                  ) : (
                    claims.map((claim) => {
                      const v = verifications[claim.id];
                      const isVerifying = verifyingIds[claim.id];
                      const playedSet = new Set(secret?.playedSongIds || []);
                      const claimPlayer = players.find((p) => p.uid === claim.playerUid);
                      const displayTicketNumber = claimPlayer?.ticketNumber || claim.ticketNumber;

                      return (
                        <div
                          key={claim.id}
                          className="rounded-2xl border border-white/10 bg-[#090D1C] p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-display text-base font-bold text-white flex items-center gap-2">
                                <span>{claim.playerName}</span>
                                <span className="font-mono text-xs text-indigo-300">
                                  Ticket {formatTicketNumber(displayTicketNumber)}
                                </span>
                              </div>
                              <div className="text-xs text-amber-300 font-semibold">
                                Pattern: {PATTERN_LABELS[claim.pattern]}
                              </div>
                            </div>
                            <span
                              className={`text-xs font-semibold capitalize ${
                                claim.status === 'approved'
                                  ? 'text-emerald-300'
                                  : claim.status === 'rejected'
                                    ? 'text-rose-300'
                                    : 'text-amber-300'
                              }`}
                            >
                              {claim.status}
                            </span>
                          </div>

                          {/* Server Verification Breakdown */}
                          {claim.status === 'pending' ? (
                            <div
                              className={`rounded-xl border px-3 py-2.5 text-xs ${
                                isVerifying
                                  ? 'border-white/10 bg-white/5 text-slate-300'
                                  : v?.isValid
                                    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                                    : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                              }`}
                            >
                              {isVerifying
                                ? 'Verifying claim against official played songs on server...'
                                : v?.summary || 'Checking...'}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-300">
                              {claim.verificationSummary}
                            </div>
                          )}

                          {/* Mini Ticket Grid Verification View */}
                          <div className="grid grid-cols-5 gap-1">
                            {claim.ticketSnapshot.map((cell) => {
                              const marked = claim.claimedSongIds.includes(cell.id);
                              const played = playedSet.has(cell.id);
                              let cellStyle = 'bg-slate-900 border-white/10 text-slate-500';
                              if (marked && played) {
                                cellStyle = 'bg-emerald-500/25 border-emerald-400 text-emerald-100';
                              } else if (marked && !played) {
                                cellStyle = 'bg-rose-500/25 border-rose-400 text-rose-100';
                              }
                              return (
                                <div
                                  key={cell.id}
                                  title={`${cell.title} (${marked ? 'Marked' : 'Unmarked'} · ${played ? 'Played' : 'Not Played'})`}
                                  className={`rounded-md border p-1.5 text-[10px] leading-tight truncate ${cellStyle}`}
                                >
                                  {cell.title}
                                </div>
                              );
                            })}
                          </div>

                          {claim.status === 'pending' && !isVerifying && (
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={(v ? !v.isValid : false) || actionBusy}
                                onClick={() => handleResolveClaim(claim, true)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                <span>{v ? 'Approve Winner' : 'Verify & Declare'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => handleResolveClaim(claim, false)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                              >
                                <XCircle className="h-4 w-4" />
                                <span>Reject</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {activePanel === 'players' && (
                <div className="divide-y divide-white/10 max-h-[540px] overflow-y-auto">
                  {players.map((p) => (
                    <div key={p.uid} className="py-3 flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Users className="h-4 w-4 text-indigo-300 shrink-0" />
                        <span className="font-medium text-white truncate">{p.name}</span>
                        {p.ticketNumber > 0 && (
                          <span className="font-mono text-xs text-amber-300 shrink-0">
                            {formatTicketNumber(p.ticketNumber)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        <span className="font-mono tabular-nums text-slate-300">
                          {p.markedSongIds.length}/15 marked
                        </span>
                        <span className={p.isOnline ? 'text-emerald-300' : 'text-slate-500'}>
                          {p.isOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activePanel === 'played' && (
                <div className="divide-y divide-white/10 max-h-[540px] overflow-y-auto">
                  {playedTracks.map((t, i) => (
                    <div key={t!.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono tabular-nums text-slate-500 w-5 shrink-0">
                          {i + 1}.
                        </span>
                        <span className="text-white font-medium truncate">{t!.title}</span>
                      </div>
                      <span className="text-slate-400 truncate max-w-[120px] shrink-0">
                        {t!.artist}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {playbackProblems.length > 0 && (
              <div className="rounded-3xl border border-rose-400/35 bg-rose-500/10 p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-rose-200">
                    <AlertTriangle className="h-4 w-4 text-rose-300 shrink-0" />
                    <h3 className="font-display text-sm font-bold text-white">
                      Problem Videos ({playbackProblems.length})
                    </h3>
                  </div>
                  {room.playlistUrl && (
                    <a
                      href={room.playlistUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-200 underline hover:text-white"
                    >
                      <span>Open Playlist</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-rose-100/90">
                  Remove these videos from your YouTube playlist after the game so they don&apos;t interrupt future rounds:
                </p>
                <div className="divide-y divide-rose-300/15 max-h-44 overflow-y-auto pr-1">
                  {playbackProblems.map((prob) => (
                    <div
                      key={prob.sourceId}
                      className="py-2 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">
                          #{prob.position} · {prob.title}
                        </div>
                        <div className="text-[11px] text-rose-200 truncate">
                          {prob.artist} · {prob.reason}
                        </div>
                      </div>
                      <a
                        href={`https://www.youtube.com/watch?v=${encodeURIComponent(prob.sourceId)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10 shrink-0"
                      >
                        <span>YouTube</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR Code Invite Modal */}
      {qrModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-invite-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-[#10162D] p-6 shadow-2xl space-y-5 text-center">
            <div className="flex items-start justify-between gap-3 text-left">
              <div>
                <h2 id="qr-invite-title" className="font-display text-xl font-extrabold text-white">
                  Scan to Join Game
                </h2>
                <p className="text-xs text-slate-300 mt-0.5">
                  {room.gameName || 'Musical Housie Night'} · Room{' '}
                  <span className="font-mono font-bold text-amber-300">{roomCode}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                aria-label="Close QR code modal"
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              ref={qrContainerRef}
              className="mx-auto inline-flex items-center justify-center rounded-2xl bg-white p-3 shadow-lg"
            >
              <QRCodeSVG
                value={qrInviteUrl}
                size={256}
                level="L"
                marginSize={4}
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>

            {hasSeparateSharedOrigin && (
              <div className="rounded-xl border border-white/10 bg-[#090D1C] p-1.5 grid grid-cols-2 gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setQrUseSharedOrigin(false)}
                  className={`rounded-lg py-1.5 font-semibold transition-colors cursor-pointer ${
                    !qrUseSharedOrigin
                      ? 'bg-indigo-500 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Current Live Link
                </button>
                <button
                  type="button"
                  onClick={() => setQrUseSharedOrigin(true)}
                  className={`rounded-lg py-1.5 font-semibold transition-colors cursor-pointer ${
                    qrUseSharedOrigin
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Shared Link (If Published)
                </button>
              </div>
            )}

            <p className="text-[11px] text-slate-400 break-all">{qrInviteUrl}</p>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              {hasSeparateSharedOrigin
                ? 'iPhone tip: Preview links (ais-dev- / ais-pre-) often fail on iPhone due to Safari cookie blocking or 404 if unpublished. For iPhone players, click Share/Publish in AI Studio and open the published public link before hosting.'
                : 'iPhone tip: If opening from WhatsApp or QR camera, tap "Open in Safari" if the page does not connect.'}
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
              >
                {copiedLink ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadQr}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-3.5 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
              >
                <Download className="h-4 w-4" />
                <span>Save PNG</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
