import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  LATE_ENTRY_GRACE_MS,
  buildTrackSongNumberMap,
  generateRoomCode,
  generateUniqueTicketsForLatePlayers,
  shuffleArray,
  verifyClaimAgainstPlayedSongs,
} from '../shared/gameLogic.ts';
import {
  ALL_PATTERNS,
  ClaimVerificationResult,
  CurrentPlayableMedia,
  HostSecretState,
  PATTERN_LABELS,
  PlayerData,
  PlaylistSourceType,
  RevealedSong,
  RoomData,
  TicketCell,
  TrackItem,
  WinnerClaim,
  WinnerRecord,
  WinningPattern,
} from '../shared/types.ts';
import {
  recordGameCompletedAnalytics,
  recordGameStartedAnalytics,
} from './analyticsService.ts';
import { OperationType, auth, db, ensureAnonymousAuth, handleFirestoreError } from './firebase.ts';

async function requireAuthenticatedUser() {
  if (auth?.currentUser) return auth.currentUser;
  const res = await ensureAnonymousAuth();
  if (res.user) return res.user;
  throw new Error(
    res.error ||
      'Unable to start your player session on this browser. Please refresh the page and try again.',
  );
}

const EMPTY_MEDIA: CurrentPlayableMedia = {
  songId: '',
  sourceType: 'none',
  sourceId: '',
  previewUrl: '',
};

function toCurrentMedia(track: TrackItem | null | undefined): CurrentPlayableMedia {
  if (!track) return EMPTY_MEDIA;
  return {
    songId: track.id.slice(0, 128),
    sourceType: track.sourceType,
    sourceId: track.sourceId.slice(0, 128),
    previewUrl: (track.previewUrl || '').slice(0, 300),
  };
}

function derivePlayedSongNumbers(
  playedSongIds: readonly string[],
  tracks: readonly TrackItem[],
): number[] {
  const numberById = buildTrackSongNumberMap(tracks);
  const seen = new Set<number>();
  const numbers: number[] = [];
  for (const id of playedSongIds) {
    const songNum = numberById.get(id);
    if (songNum !== undefined && !seen.has(songNum)) {
      seen.add(songNum);
      numbers.push(songNum);
    }
  }
  return numbers.slice(0, 200);
}

export interface SavedSession {
  roomCode: string;
  role: 'host' | 'player';
  name: string;
}

export interface RoomEntryStatusInfo {
  exists: boolean;
  roomCode: string;
  status?: 'lobby' | 'playing' | 'paused' | 'ended';
  isExpired?: boolean;
  isHost?: boolean;
  isExistingPlayer?: boolean;
  startedAtMs?: number | null;
  deadlineMs?: number | null;
  serverNowMs: number;
  remainingMs?: number;
  lateEntryOpen?: boolean;
  playerCount?: number;
  gameName?: string;
}

export async function fetchRoomEntryStatus(rawRoomCode: string): Promise<RoomEntryStatusInfo> {
  const roomCode = rawRoomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
    throw new Error('Invalid Ticket Code. Please Check and Try Again.');
  }

  const roomRef = doc(db, 'rooms', roomCode);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) {
    return {
      exists: false,
      roomCode,
      serverNowMs: Date.now(),
      lateEntryOpen: false,
    };
  }

  const room = roomSnap.data() as RoomData;
  const startedMs =
    room.startedAt && typeof (room.startedAt as Timestamp).toMillis === 'function'
      ? (room.startedAt as Timestamp).toMillis()
      : null;

  const now = Date.now();
  const deadlineMs = startedMs ? startedMs + LATE_ENTRY_GRACE_MS : null;
  const lateEntryOpen =
    room.status === 'lobby' || (startedMs !== null && now < startedMs + LATE_ENTRY_GRACE_MS);

  return {
    exists: true,
    roomCode,
    status: room.status,
    isHost: auth?.currentUser?.uid === room.hostUid,
    startedAtMs: startedMs,
    deadlineMs,
    serverNowMs: now,
    remainingMs: deadlineMs ? Math.max(0, deadlineMs - now) : 0,
    lateEntryOpen,
    playerCount: room.playerCount || 0,
    gameName: room.gameName,
  };
}

const SESSION_KEY = 'musical_housie_session_v1';
const HOSTED_ROOMS_KEY = 'musical_housie_hosted_rooms_v1';

export function isFirestoreQuotaError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('quota exceeded') ||
    msg.includes('resource-exhausted') ||
    msg.includes('resource exhausted') ||
    msg.includes('free daily read units') ||
    msg.includes('daily limit')
  );
}

function loadTrackedHostedRooms(): string[] {
  try {
    const raw = localStorage.getItem(HOSTED_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string' && /^[A-Z0-9]{6}$/.test(c));
  } catch {
    return [];
  }
}

function saveTrackedHostedRooms(codes: string[]) {
  try {
    const unique = Array.from(new Set(codes)).slice(0, 20);
    localStorage.setItem(HOSTED_ROOMS_KEY, JSON.stringify(unique));
  } catch {
    // Ignore storage quota errors
  }
}

function trackHostedRoom(roomCode: string) {
  const existing = loadTrackedHostedRooms().filter((c) => c !== roomCode);
  saveTrackedHostedRooms([roomCode, ...existing]);
}

function untrackHostedRoom(roomCode: string) {
  saveTrackedHostedRooms(loadTrackedHostedRooms().filter((c) => c !== roomCode));
}

export async function deleteRoomData(roomCode: string): Promise<boolean> {
  const user = auth?.currentUser;
  if (!user || !/^[A-Z0-9]{6}$/.test(roomCode)) {
    untrackHostedRoom(roomCode);
    return false;
  }

  const roomRef = doc(db, 'rooms', roomCode);
  let roomSnap;
  try {
    roomSnap = await getDoc(roomRef);
  } catch (err) {
    if (isFirestoreQuotaError(err)) throw err;
    untrackHostedRoom(roomCode);
    return false;
  }

  if (!roomSnap.exists()) {
    untrackHostedRoom(roomCode);
    const saved = loadLocalSession();
    if (saved?.roomCode === roomCode) saveLocalSession(null);
    return false;
  }

  const roomData = roomSnap.data() as RoomData;
  if (roomData.hostUid !== user.uid) {
    untrackHostedRoom(roomCode);
    return false;
  }

  const refsToDelete = [];

  try {
    const playersSnap = await getDocs(
      query(collection(db, 'rooms', roomCode, 'players'), where('hostUid', '==', user.uid)),
    );
    for (const d of playersSnap.docs) refsToDelete.push(d.ref);

    const claimsSnap = await getDocs(
      query(collection(db, 'rooms', roomCode, 'claims'), where('hostUid', '==', user.uid)),
    );
    for (const d of claimsSnap.docs) refsToDelete.push(d.ref);

    const winnersSnap = await getDocs(
      query(collection(db, 'rooms', roomCode, 'winners'), where('hostUid', '==', user.uid)),
    );
    for (const d of winnersSnap.docs) refsToDelete.push(d.ref);

    const secretRef = doc(db, 'rooms', roomCode, 'hostState', 'secret');
    const secretSnap = await getDoc(secretRef);
    if (secretSnap.exists() && secretSnap.data().hostUid === user.uid) {
      refsToDelete.push(secretRef);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `rooms/${roomCode}`);
  }

  refsToDelete.push(roomRef);

  try {
    for (let i = 0; i < refsToDelete.length; i += 400) {
      const batch = writeBatch(db);
      for (const ref of refsToDelete.slice(i, i + 400)) {
        batch.delete(ref);
      }
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `rooms/${roomCode}`);
  }

  untrackHostedRoom(roomCode);
  const saved = loadLocalSession();
  if (saved?.roomCode === roomCode) {
    saveLocalSession(null);
  }
  return true;
}

export async function cleanupExpiredOrEndedHostedRooms(options?: {
  includeAllForHost?: boolean;
  excludeRoomCode?: string;
}): Promise<number> {
  const user = auth?.currentUser;
  if (!user) return 0;

  const tracked = loadTrackedHostedRooms();
  if (tracked.length === 0) return 0;

  let deletedCount = 0;
  for (const code of tracked) {
    if (options?.excludeRoomCode && code === options.excludeRoomCode) continue;
    try {
      const snap = await getDoc(doc(db, 'rooms', code));
      if (!snap.exists()) {
        untrackHostedRoom(code);
        continue;
      }
      const data = snap.data() as RoomData;
      if (data.hostUid !== user.uid) {
        untrackHostedRoom(code);
        continue;
      }

      const expiresMs =
        data.expiresAt && typeof (data.expiresAt as Timestamp).toMillis === 'function'
          ? (data.expiresAt as Timestamp).toMillis()
          : 0;
      const isExpired = expiresMs > 0 && expiresMs < Date.now();
      const isEnded = data.status === 'ended';
      const isEmptyLobby = data.status === 'lobby' && (data.playerCount || 0) === 0;

      if (options?.includeAllForHost || isEnded || isExpired || isEmptyLobby) {
        const deleted = await deleteRoomData(code);
        if (deleted) deletedCount++;
      }
    } catch {
      // Skip non-fatal cleanup errors
    }
  }
  return deletedCount;
}

export function saveLocalSession(session: SavedSession | null) {
  try {
    if (!session) {
      localStorage.removeItem(SESSION_KEY);
    } else {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLocalSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (
      parsed &&
      typeof parsed.roomCode === 'string' &&
      /^[A-Z0-9]{6}$/.test(parsed.roomCode) &&
      (parsed.role === 'host' || parsed.role === 'player')
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function createGameRoom(
  hostName: string,
  gameName: string,
): Promise<{ roomCode: string }> {
  const user = await requireAuthenticatedUser();

  const cleanHostName = hostName.trim().slice(0, 40);
  const cleanGameName = gameName.trim().slice(0, 60);
  if (!cleanHostName) {
    throw new Error('Please enter your Host Name.');
  }

  await cleanupExpiredOrEndedHostedRooms().catch(() => {});

  let roomCode = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateRoomCode();
    const roomRef = doc(db, 'rooms', candidate);
    try {
      const existingSnap = await getDoc(roomRef);
      if (!existingSnap.exists()) {
        roomCode = candidate;
        break;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `rooms/${candidate}`);
    }
  }

  if (!roomCode) {
    throw new Error('Could not allocate a unique room code. Please try again.');
  }

  const writeNewRoom = async () => {
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000));
    const roomRef = doc(db, 'rooms', roomCode);
    const secretRef = doc(db, 'rooms', roomCode, 'hostState', 'secret');

    const batch = writeBatch(db);
    batch.set(roomRef, {
      roomCode,
      gameName: cleanGameName,
      hostUid: user.uid,
      hostName: cleanHostName,
      status: 'lobby',
      sourceType: 'none',
      playlistName: '',
      playlistUrl: '',
      totalSongs: 0,
      currentSongNumber: 0,
      currentSongRevealed: false,
      currentMedia: EMPTY_MEDIA,
      revealedCurrentSong: { id: '', title: '', artist: '', sourceId: '' },
      revealedSongs: [],
      playedSongIds: [],
      playedSongNumbers: [],
      enabledPatterns: [...ALL_PATTERNS],
      winners: [],
      playersSummary: [],
      randomMode: true,
      playerCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAt,
    });

    batch.set(secretRef, {
      hostUid: user.uid,
      tracks: [],
      queueOrder: [],
      currentSongId: '',
      playedSongIds: [],
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  };

  try {
    await writeNewRoom();
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      await cleanupExpiredOrEndedHostedRooms({ includeAllForHost: true }).catch(() => {});
      try {
        await writeNewRoom();
      } catch (retryErr) {
        if (isFirestoreQuotaError(retryErr)) {
          throw new Error(
            'Firebase data limit reached. Previous hosted rooms were cleaned up, or the daily free-tier read/write quota has been reached (resets tomorrow).',
          );
        }
        handleFirestoreError(retryErr, OperationType.WRITE, `rooms/${roomCode}`);
      }
    } else {
      handleFirestoreError(err, OperationType.WRITE, `rooms/${roomCode}`);
    }
  }

  trackHostedRoom(roomCode);
  saveLocalSession({ roomCode, role: 'host', name: cleanHostName });
  return { roomCode };
}

export async function joinGameRoom(
  playerName: string,
  rawRoomCode: string,
): Promise<{ roomCode: string; role: 'host' | 'player' }> {
  const user = await requireAuthenticatedUser();

  const cleanName = playerName.trim().slice(0, 40);
  const roomCode = rawRoomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!cleanName) {
    throw new Error('Please enter your Player Name.');
  }
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
    throw new Error('Room code must be 6 letters or numbers.');
  }

  const roomRef = doc(db, 'rooms', roomCode);
  let roomSnap;
  try {
    roomSnap = await getDoc(roomRef);
  } catch (err) {
    const rawMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (rawMsg.includes('offline') || rawMsg.includes('unavailable') || rawMsg.includes('network')) {
      throw new Error(
        'Cannot reach the game server right now. Check your internet connection, tap Retry, or open this page directly in Safari.',
      );
    }
    handleFirestoreError(err, OperationType.GET, `rooms/${roomCode}`);
  }

  if (!roomSnap.exists()) {
    throw new Error('Invalid Ticket Code. Please Check and Try Again.');
  }

  const room = roomSnap.data() as RoomData;
  const expiresMs =
    room.expiresAt && typeof (room.expiresAt as Timestamp).toMillis === 'function'
      ? (room.expiresAt as Timestamp).toMillis()
      : Date.now() + 10000;

  if (expiresMs < Date.now()) {
    throw new Error(`Room ${roomCode} has expired. Ask the host to create a fresh game.`);
  }

  if (room.hostUid === user.uid) {
    saveLocalSession({ roomCode, role: 'host', name: room.hostName });
    return { roomCode, role: 'host' };
  }

  const playerRef = doc(db, 'rooms', roomCode, 'players', user.uid);
  let playerSnap;
  try {
    playerSnap = await getDoc(playerRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `rooms/${roomCode}/players/${user.uid}`);
  }

  if (playerSnap.exists()) {
    if (room.status !== 'ended') {
      try {
        const updates: Record<string, unknown> = {
          isOnline: true,
          lastSeenAt: serverTimestamp(),
        };
        if (room.status === 'lobby') {
          updates.name = cleanName;
        }
        await updateDoc(playerRef, updates);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}/players/${user.uid}`);
      }
    }
    saveLocalSession({ roomCode, role: 'player', name: cleanName });
    return { roomCode, role: 'player' };
  }

  if (room.status === 'ended') {
    throw new Error('Game Completed – New Entry Not Allowed');
  }

  if (room.status !== 'lobby') {
    const startedMs =
      room.startedAt && typeof (room.startedAt as Timestamp).toMillis === 'function'
        ? (room.startedAt as Timestamp).toMillis()
        : null;
    const lateEntryAllowed = startedMs !== null && Date.now() < startedMs + LATE_ENTRY_GRACE_MS;

    if (!lateEntryAllowed) {
      throw new Error('Game Started – Late Entry Closed. You can no longer join this game.');
    }
  }

  const duplicateName = (room.playersSummary || []).some(
    (p) => p.uid !== user.uid && p.name.trim().toLowerCase() === cleanName.toLowerCase(),
  );
  if (duplicateName) {
    throw new Error(
      `A player named "${cleanName}" is already in this room. Please use a unique name or add your last initial.`,
    );
  }

  try {
    await setDoc(playerRef, {
      uid: user.uid,
      roomId: roomCode,
      hostUid: room.hostUid,
      name: cleanName,
      isOnline: true,
      ticket: [],
      ticketNumber: 0,
      markedSongIds: [],
      joinedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  } catch (err) {
    const rawMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (
      room.status !== 'lobby' &&
      (rawMsg.includes('permission') || rawMsg.includes('missing or insufficient'))
    ) {
      throw new Error('Game Started – Late Entry Closed. You can no longer join this game.');
    }
    handleFirestoreError(err, OperationType.CREATE, `rooms/${roomCode}/players/${user.uid}`);
  }

  saveLocalSession({ roomCode, role: 'player', name: cleanName });
  return { roomCode, role: 'player' };
}

export async function leaveLobbyAsPlayer(roomCode: string): Promise<void> {
  const user = auth?.currentUser;
  if (!user) return;
  try {
    const roomSnap = await getDoc(doc(db, 'rooms', roomCode));
    if (roomSnap.exists() && (roomSnap.data() as RoomData).status === 'lobby') {
      await deleteDoc(doc(db, 'rooms', roomCode, 'players', user.uid));
    } else if (roomSnap.exists()) {
      await updateDoc(doc(db, 'rooms', roomCode, 'players', user.uid), {
        isOnline: false,
        lastSeenAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-blocking cleanup
  } finally {
    saveLocalSession(null);
  }
}

export async function updatePlayerOnlineStatus(roomCode: string, isOnline: boolean): Promise<void> {
  const user = auth?.currentUser;
  if (!user) return;
  const playerRef = doc(db, 'rooms', roomCode, 'players', user.uid);
  try {
    await updateDoc(playerRef, {
      isOnline,
      lastSeenAt: serverTimestamp(),
    });
  } catch {
    // Ignore transient offline status update errors
  }
}

export async function savePlaylistToRoom(params: {
  roomCode: string;
  hostUid: string;
  sourceType: PlaylistSourceType;
  playlistName: string;
  playlistUrl: string;
  tracks: TrackItem[];
  enabledPatterns: WinningPattern[];
  randomMode: boolean;
}): Promise<void> {
  const {
    roomCode,
    hostUid,
    sourceType,
    playlistName,
    playlistUrl,
    tracks,
    enabledPatterns,
    randomMode,
  } = params;

  const trimmedTracks = tracks.slice(0, 200).map((t) => ({
    id: t.id.slice(0, 128),
    title: t.title.slice(0, 120),
    artist: t.artist.slice(0, 80),
    sourceId: t.sourceId.slice(0, 128),
    sourceType: t.sourceType,
    ...(t.thumbnailUrl ? { thumbnailUrl: t.thumbnailUrl.slice(0, 300) } : {}),
    ...(t.previewUrl ? { previewUrl: t.previewUrl.slice(0, 300) } : {}),
  }));

  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomCode), {
    sourceType,
    playlistName: playlistName.slice(0, 120),
    playlistUrl: playlistUrl.slice(0, 300),
    totalSongs: trimmedTracks.length,
    playedSongIds: [],
    playedSongNumbers: [],
    enabledPatterns: enabledPatterns.length > 0 ? enabledPatterns : ['full_house'],
    randomMode,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'rooms', roomCode, 'hostState', 'secret'), {
    hostUid,
    tracks: trimmedTracks,
    queueOrder: [],
    currentSongId: '',
    playedSongIds: [],
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomCode}`);
  }
}

export async function updateLobbySettings(
  roomCode: string,
  enabledPatterns: WinningPattern[],
  randomMode: boolean,
): Promise<void> {
  if (enabledPatterns.length === 0) return;
  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      enabledPatterns,
      randomMode,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
  }
}

export async function syncPlayersSummary(roomCode: string, players: PlayerData[]): Promise<void> {
  const summary = players.slice(0, 100).map((p) => ({
    uid: p.uid,
    name: p.name.slice(0, 40),
    isOnline: Boolean(p.isOnline),
  }));
  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      playersSummary: summary,
      playerCount: players.length,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
  }
}

export async function startGameAndDealTickets(params: {
  roomCode: string;
  hostUid: string;
  players: PlayerData[];
  tracks: TrackItem[];
  enabledPatterns: WinningPattern[];
  randomMode: boolean;
}): Promise<void> {
  const { roomCode, hostUid, players, tracks, enabledPatterns, randomMode } = params;

  if (tracks.length < 15) {
    throw new Error(
      `Cannot start game: at least 15 accessible songs are needed (currently ${tracks.length}).`,
    );
  }
  if (players.length === 0) {
    throw new Error('Wait for at least 1 player to join before starting the game.');
  }
  if (enabledPatterns.length === 0) {
    throw new Error('Select at least 1 winning pattern before starting.');
  }

  const orderedPlayers = [...players].sort((a, b) => {
    const aMs =
      a.joinedAt && typeof (a.joinedAt as Timestamp).toMillis === 'function'
        ? (a.joinedAt as Timestamp).toMillis()
        : 0;
    const bMs =
      b.joinedAt && typeof (b.joinedAt as Timestamp).toMillis === 'function'
        ? (b.joinedAt as Timestamp).toMillis()
        : 0;
    return aMs - bMs || a.uid.localeCompare(b.uid);
  });

  // Client-side unique ticket allocation
  const ticketsByPlayer: Record<string, TicketCell[]> = {};
  const ticketNumbersByPlayer: Record<string, number> = {};

  orderedPlayers.forEach((player, idx) => {
    const shuffledTracks = shuffleArray(tracks).slice(0, 15);
    const ticket: TicketCell[] = shuffledTracks.map((t, cellIdx) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      sourceId: t.sourceId,
      position: cellIdx,
    }));

    ticketsByPlayer[player.uid] = ticket;
    ticketNumbersByPlayer[player.uid] = idx + 1;
  });

  const orderedTracks = randomMode ? shuffleArray(tracks) : [...tracks];
  const queueOrder = orderedTracks.map((t) => t.id);
  const firstSongId = queueOrder[0];
  const initialPlayedIds = firstSongId ? [firstSongId] : [];
  const initialPlayedNumbers = derivePlayedSongNumbers(initialPlayedIds, tracks);

  const ticketAssignments = orderedPlayers.map((player) => {
    const assignedTicket = ticketsByPlayer[player.uid];
    if (!assignedTicket || assignedTicket.length !== 15) {
      throw new Error(`Failed to allocate 15-song ticket for ${player.name}.`);
    }
    const ticketNumber = ticketNumbersByPlayer[player.uid];
    return { player, assignedTicket, ticketNumber };
  });

  try {
    const BATCH_LIMIT = 400;
    for (let i = 0; i < ticketAssignments.length; i += BATCH_LIMIT) {
      const chunk = ticketAssignments.slice(i, i + BATCH_LIMIT);
      const isLastChunk = i + BATCH_LIMIT >= ticketAssignments.length;
      const batch = writeBatch(db);

      for (const { player, assignedTicket, ticketNumber } of chunk) {
        batch.update(doc(db, 'rooms', roomCode, 'players', player.uid), {
          ticket: assignedTicket,
          ticketNumber,
          markedSongIds: [],
          lastSeenAt: serverTimestamp(),
        });
      }

      if (isLastChunk) {
        batch.update(doc(db, 'rooms', roomCode, 'hostState', 'secret'), {
          hostUid,
          queueOrder,
          currentSongId: firstSongId,
          playedSongIds: initialPlayedIds,
          updatedAt: serverTimestamp(),
        });

        batch.update(doc(db, 'rooms', roomCode), {
          status: 'playing',
          startedAt: serverTimestamp(),
          currentSongNumber: 1,
          currentSongRevealed: false,
          currentMedia: toCurrentMedia(orderedTracks[0]),
          revealedCurrentSong: { id: '', title: '', artist: '', sourceId: '' },
          revealedSongs: [],
          playedSongIds: initialPlayedIds,
          playedSongNumbers: initialPlayedNumbers,
          randomMode,
          enabledPatterns,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }
    recordGameStartedAnalytics(orderedPlayers.length).catch(() => {});
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomCode}`);
  }
}

export async function dealLatePlayerTickets(params: {
  roomCode: string;
  latePlayers: PlayerData[];
  existingPlayers: PlayerData[];
  tracks: TrackItem[];
  playedSongIds: string[];
}): Promise<number> {
  const { roomCode, latePlayers, existingPlayers, tracks, playedSongIds } = params;

  const eligibleLatePlayers = latePlayers.filter(
    (p) => p.ticket.length === 0 && (p.ticketNumber || 0) === 0,
  );
  if (eligibleLatePlayers.length === 0 || tracks.length < 15) {
    return 0;
  }

  const sortedLatePlayers = [...eligibleLatePlayers].sort((a, b) => {
    const aMs =
      a.joinedAt && typeof (a.joinedAt as Timestamp).toMillis === 'function'
        ? (a.joinedAt as Timestamp).toMillis()
        : 0;
    const bMs =
      b.joinedAt && typeof (b.joinedAt as Timestamp).toMillis === 'function'
        ? (b.joinedAt as Timestamp).toMillis()
        : 0;
    return aMs - bMs || a.uid.localeCompare(b.uid);
  });

  const existingTickets = existingPlayers
    .map((p) => p.ticket)
    .filter((t): t is TicketCell[] => Array.isArray(t) && t.length === 15);
  const maxTicketNumber = existingPlayers.reduce(
    (max, p) => Math.max(max, Number(p.ticketNumber || 0)),
    0,
  );

  const ticketsByPlayer = generateUniqueTicketsForLatePlayers(
    tracks,
    sortedLatePlayers.map((p) => p.uid),
    existingTickets,
  );

  const playedIdSet = new Set(playedSongIds);
  const playedNumberSet = new Set(derivePlayedSongNumbers(playedSongIds, tracks));

  const BATCH_LIMIT = 400;
  try {
    for (let i = 0; i < sortedLatePlayers.length; i += BATCH_LIMIT) {
      const chunk = sortedLatePlayers.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);

      chunk.forEach((player, idx) => {
        const assignedTicket = ticketsByPlayer[player.uid];
        if (!assignedTicket || assignedTicket.length !== 15) return;
        const ticketNumber = maxTicketNumber + i + idx + 1;
        const preMarkedSongIds = assignedTicket
          .filter(
            (cell) =>
              playedIdSet.has(cell.id) ||
              (typeof cell.songNumber === 'number' && playedNumberSet.has(cell.songNumber)),
          )
          .map((cell) => cell.id)
          .slice(0, 15);

        batch.update(doc(db, 'rooms', roomCode, 'players', player.uid), {
          ticket: assignedTicket,
          ticketNumber,
          markedSongIds: preMarkedSongIds,
          lastSeenAt: serverTimestamp(),
        });
      });

      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomCode}/players`);
  }

  return sortedLatePlayers.length;
}

export async function setRoomPlaybackStatus(
  roomCode: string,
  status: 'playing' | 'paused',
): Promise<void> {
  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
  }
}

export async function toggleRandomModeLive(
  roomCode: string,
  secret: HostSecretState,
  nextRandomMode: boolean,
): Promise<void> {
  const playedSet = new Set(secret.playedSongIds);
  const unplayedIds = secret.queueOrder.filter((id) => !playedSet.has(id));
  const playedOrdered = secret.queueOrder.filter((id) => playedSet.has(id));

  let reorderedUnplayed: string[];
  if (nextRandomMode) {
    reorderedUnplayed = shuffleArray(unplayedIds);
  } else {
    const trackIndexMap = new Map(secret.tracks.map((t, idx) => [t.id, idx]));
    reorderedUnplayed = [...unplayedIds].sort(
      (a, b) => (trackIndexMap.get(a) ?? 0) - (trackIndexMap.get(b) ?? 0),
    );
  }

  const nextQueue = [...playedOrdered, ...reorderedUnplayed];

  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomCode, 'hostState', 'secret'), {
    queueOrder: nextQueue,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'rooms', roomCode), {
    randomMode: nextRandomMode,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomCode}`);
  }
}

export async function advanceToNextSong(
  roomCode: string,
  room: RoomData,
  secret: HostSecretState,
): Promise<{ finishedPlaylist: boolean }> {
  const currentIdx = room.currentSongNumber - 1;
  const currentTrack = secret.tracks.find((t) => t.id === secret.currentSongId) || null;

  const nextRevealedSongs: RevealedSong[] = [...(room.revealedSongs || [])];
  if (currentTrack && !nextRevealedSongs.some((s) => s.id === currentTrack.id)) {
    nextRevealedSongs.push({
      id: currentTrack.id,
      title: currentTrack.title.slice(0, 120),
      artist: currentTrack.artist.slice(0, 80),
      sourceId: currentTrack.sourceId,
    });
  }

  const basePlayedIds = Array.from(
    new Set([...(secret.playedSongIds || []), ...(room.playedSongIds || [])]),
  ).slice(0, 200);

  const nextIdx = currentIdx + 1;
  if (nextIdx >= secret.queueOrder.length) {
    const finalPlayedIds =
      currentTrack && !basePlayedIds.includes(currentTrack.id)
        ? [...basePlayedIds, currentTrack.id].slice(0, 200)
        : basePlayedIds;
    const finalPlayedNumbers = derivePlayedSongNumbers(finalPlayedIds, secret.tracks);

    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'paused',
      currentSongRevealed: true,
      currentMedia: EMPTY_MEDIA,
      revealedCurrentSong: currentTrack
        ? {
            id: currentTrack.id,
            title: currentTrack.title.slice(0, 120),
            artist: currentTrack.artist.slice(0, 80),
            sourceId: currentTrack.sourceId,
          }
        : room.revealedCurrentSong,
      revealedSongs: nextRevealedSongs,
      playedSongIds: finalPlayedIds,
      playedSongNumbers: finalPlayedNumbers,
      updatedAt: serverTimestamp(),
    });
    return { finishedPlaylist: true };
  }

  const nextSongId = secret.queueOrder[nextIdx];
  const nextTrack = secret.tracks.find((t) => t.id === nextSongId) || null;
  const updatedPlayedIds = basePlayedIds.includes(nextSongId)
    ? basePlayedIds
    : [...basePlayedIds, nextSongId].slice(0, 200);
  const updatedPlayedNumbers = derivePlayedSongNumbers(updatedPlayedIds, secret.tracks);

  const batch = writeBatch(db);
  batch.update(doc(db, 'rooms', roomCode, 'hostState', 'secret'), {
    currentSongId: nextSongId,
    playedSongIds: updatedPlayedIds,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'rooms', roomCode), {
    status: 'playing',
    currentSongNumber: nextIdx + 1,
    currentSongRevealed: false,
    currentMedia: toCurrentMedia(nextTrack),
    revealedCurrentSong: { id: '', title: '', artist: '', sourceId: '' },
    revealedSongs: nextRevealedSongs,
    playedSongIds: updatedPlayedIds,
    playedSongNumbers: updatedPlayedNumbers,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomCode}`);
  }

  return { finishedPlaylist: false };
}

export async function revealCurrentSongToPlayers(
  roomCode: string,
  room: RoomData,
  currentTrack: TrackItem,
): Promise<void> {
  const revealedObj: RevealedSong = {
    id: currentTrack.id,
    title: currentTrack.title.slice(0, 120),
    artist: currentTrack.artist.slice(0, 80),
    sourceId: currentTrack.sourceId,
  };

  const nextRevealedSongs = [...(room.revealedSongs || [])];
  if (!nextRevealedSongs.some((s) => s.id === currentTrack.id)) {
    nextRevealedSongs.push(revealedObj);
  }

  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      currentSongRevealed: true,
      revealedCurrentSong: revealedObj,
      revealedSongs: nextRevealedSongs,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
  }
}

export async function endGameRoom(
  roomCode: string,
  room: RoomData,
  currentTrack: TrackItem | null,
): Promise<void> {
  const nextRevealedSongs = [...(room.revealedSongs || [])];
  let revealedCurrent = room.revealedCurrentSong;
  if (currentTrack) {
    revealedCurrent = {
      id: currentTrack.id,
      title: currentTrack.title.slice(0, 120),
      artist: currentTrack.artist.slice(0, 80),
      sourceId: currentTrack.sourceId,
    };
    if (!nextRevealedSongs.some((s) => s.id === currentTrack.id)) {
      nextRevealedSongs.push(revealedCurrent);
    }
  }

  try {
    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'ended',
      currentSongRevealed: Boolean(currentTrack),
      currentMedia: EMPTY_MEDIA,
      revealedCurrentSong: revealedCurrent,
      revealedSongs: nextRevealedSongs,
      updatedAt: serverTimestamp(),
    });
    recordGameCompletedAnalytics().catch(() => {});
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}`);
  }
}

export async function togglePlayerTicketMark(
  roomCode: string,
  playerUid: string,
  currentMarkedIds: string[],
  songId: string,
): Promise<void> {
  const exists = currentMarkedIds.includes(songId);
  const nextMarked = exists
    ? currentMarkedIds.filter((id) => id !== songId)
    : [...currentMarkedIds, songId].slice(0, 15);

  try {
    await updateDoc(doc(db, 'rooms', roomCode, 'players', playerUid), {
      markedSongIds: nextMarked,
      lastSeenAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}/players/${playerUid}`);
  }
}

export async function autoMarkPlayerSongs(
  roomCode: string,
  playerUid: string,
  currentMarkedIds: string[],
  songIdsToMark: string[],
): Promise<boolean> {
  const existingSet = new Set(currentMarkedIds);
  const missing = songIdsToMark.filter((id) => !existingSet.has(id));
  if (missing.length === 0) return false;

  const nextMarked = Array.from(new Set([...currentMarkedIds, ...missing])).slice(0, 15);
  try {
    await updateDoc(doc(db, 'rooms', roomCode, 'players', playerUid), {
      markedSongIds: nextMarked,
      lastSeenAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomCode}/players/${playerUid}`);
  }
}

export async function submitWinnerClaim(
  room: RoomData,
  player: PlayerData,
  pattern: WinningPattern,
  effectiveMarkedIds?: string[],
): Promise<void> {
  const roomRef = doc(db, 'rooms', room.roomCode);
  let freshRoomSnap;
  try {
    freshRoomSnap = await getDoc(roomRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `rooms/${room.roomCode}`);
  }

  if (!freshRoomSnap.exists()) {
    throw new Error('This game room no longer exists.');
  }
  const freshRoom = freshRoomSnap.data() as RoomData;
  if (freshRoom.status === 'ended') {
    throw new Error('This game has already ended.');
  }
  if (!freshRoom.enabledPatterns.includes(pattern)) {
    throw new Error(`${PATTERN_LABELS[pattern]} is not enabled in this game.`);
  }

  const winnerId = `${pattern}_${player.uid}`;
  const winnerRef = doc(db, 'rooms', room.roomCode, 'winners', winnerId);
  let winnerSnap;
  try {
    winnerSnap = await getDoc(winnerRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `rooms/${room.roomCode}/winners/${winnerId}`);
  }
  if (winnerSnap.exists()) {
    throw new Error(
      `Duplicate claim rejected: you have already won ${PATTERN_LABELS[pattern]} in this game.`,
    );
  }

  const claimId = `${player.uid}_${pattern}`;
  const claimRef = doc(db, 'rooms', room.roomCode, 'claims', claimId);

  let existingSnap;
  try {
    existingSnap = await getDoc(claimRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `rooms/${room.roomCode}/claims/${claimId}`);
  }

  const claimedAtMs = Date.now();
  const ticketNumber = player.ticketNumber || 0;
  const ticketIdSet = new Set(player.ticket.map((c) => c.id));
  const resolvedClaimedSongIds = Array.from(
    new Set((effectiveMarkedIds || player.markedSongIds).filter((id) => ticketIdSet.has(id))),
  ).slice(0, 15);

  if (existingSnap.exists()) {
    const existing = existingSnap.data() as WinnerClaim;
    if (existing.status === 'pending') {
      throw new Error('Your claim for this pattern is already pending server verification.');
    }
    if (existing.status === 'approved') {
      throw new Error(`You have already won ${PATTERN_LABELS[pattern]} in this game.`);
    }
    try {
      await updateDoc(claimRef, {
        status: 'pending',
        ticketNumber,
        claimedSongIds: resolvedClaimedSongIds,
        ticketSnapshot: player.ticket,
        claimedAtMs,
        verifiedMatchedIds: [],
        verificationSummary: 'Verifying claim against official played songs...',
        updatedAt: serverTimestamp(),
      });
      return;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rooms/${room.roomCode}/claims/${claimId}`);
    }
  }

  try {
    await setDoc(claimRef, {
      id: claimId,
      roomId: room.roomCode,
      hostUid: room.hostUid,
      playerUid: player.uid,
      playerName: player.name,
      ticketNumber,
      pattern,
      claimedSongIds: resolvedClaimedSongIds,
      ticketSnapshot: player.ticket,
      claimedAtMs,
      status: 'pending',
      verifiedMatchedIds: [],
      verificationSummary: 'Verifying claim against official played songs...',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `rooms/${room.roomCode}/claims/${claimId}`);
  }
}

export async function verifyClaimOnServer(
  roomCode: string,
  claimId: string,
): Promise<ClaimVerificationResult> {
  const claimRef = doc(db, 'rooms', roomCode, 'claims', claimId);
  const secretRef = doc(db, 'rooms', roomCode, 'hostState', 'secret');

  const [claimSnap, secretSnap] = await Promise.all([getDoc(claimRef), getDoc(secretRef)]);

  if (!claimSnap.exists()) {
    throw new Error('Claim record not found.');
  }

  const claim = claimSnap.data() as WinnerClaim;
  const playedSongIds = secretSnap.exists()
    ? (secretSnap.data() as HostSecretState).playedSongIds || []
    : [];

  const verification = verifyClaimAgainstPlayedSongs(
    claim.ticketSnapshot,
    claim.claimedSongIds,
    playedSongIds,
    claim.pattern,
  );

  return {
    ...verification,
    ticketNumber: claim.ticketNumber,
    serverProcessedAtMs: Date.now(),
  };
}

export async function resolveWinnerClaim(params: {
  room: RoomData;
  claim: WinnerClaim;
  approve: boolean;
  verification: ClaimVerificationResult;
}): Promise<{ declared: boolean; duplicate: boolean }> {
  const { room, claim, approve, verification } = params;
  const roomRef = doc(db, 'rooms', room.roomCode);
  const claimRef = doc(db, 'rooms', room.roomCode, 'claims', claim.id);
  const winnerId = `${claim.pattern}_${claim.playerUid}`;
  const winnerRef = doc(db, 'rooms', room.roomCode, 'winners', winnerId);
  const playerRef = doc(db, 'rooms', room.roomCode, 'players', claim.playerUid);

  if (approve && !verification.isValid) {
    throw new Error(`Cannot approve invalid claim: ${verification.summary}`);
  }

  let outcome = { declared: false, duplicate: false };

  try {
    await runTransaction(db, async (tx) => {
      const [roomSnap, claimSnap, winnerSnap, playerSnap] = await Promise.all([
        tx.get(roomRef),
        tx.get(claimRef),
        tx.get(winnerRef),
        tx.get(playerRef),
      ]);

      if (!roomSnap.exists() || !claimSnap.exists()) {
        return;
      }

      const liveRoom = roomSnap.data() as RoomData;
      const liveClaim = claimSnap.data() as WinnerClaim;
      if (liveRoom.status === 'ended' || liveClaim.status !== 'pending') {
        return;
      }

      if (winnerSnap.exists()) {
        tx.update(claimRef, {
          status: 'rejected',
          verifiedMatchedIds: [],
          verificationSummary: 'Rejected duplicate claim: player already won this pattern.',
          updatedAt: serverTimestamp(),
        });
        outcome = { declared: false, duplicate: true };
        return;
      }

      if (approve && verification.isValid) {
        const playerTicketNumber = playerSnap.exists()
          ? Number((playerSnap.data() as PlayerData).ticketNumber || 0)
          : 0;
        const resolvedTicketNumber = Math.max(
          1,
          verification.ticketNumber || playerTicketNumber || claim.ticketNumber || 1,
        );
        const approvedAtMs = verification.serverProcessedAtMs || Date.now();

        tx.set(winnerRef, {
          id: winnerId,
          roomId: room.roomCode,
          hostUid: liveRoom.hostUid,
          claimId: claim.id,
          playerUid: claim.playerUid,
          playerName: claim.playerName,
          ticketNumber: resolvedTicketNumber,
          pattern: claim.pattern,
          approvedAtMs,
          createdAt: serverTimestamp(),
        });

        tx.update(claimRef, {
          status: 'approved',
          verifiedMatchedIds: verification.matchedPlayedIds.slice(0, 15),
          verificationSummary: verification.summary.slice(0, 240),
          updatedAt: serverTimestamp(),
        });
        outcome = { declared: true, duplicate: false };
      } else {
        tx.update(claimRef, {
          status: 'rejected',
          verifiedMatchedIds: verification.matchedPlayedIds.slice(0, 15),
          verificationSummary: verification.summary.slice(0, 240),
          updatedAt: serverTimestamp(),
        });
        outcome = { declared: false, duplicate: false };
      }
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${room.roomCode}`);
  }

  return outcome;
}

export function subscribeToRoom(
  roomCode: string,
  onData: (room: RoomData | null) => void,
  onError: (err: Error) => void,
) {
  const path = `rooms/${roomCode}`;
  return onSnapshot(
    doc(db, 'rooms', roomCode),
    (snap) => {
      onData(snap.exists() ? (snap.data() as RoomData) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    },
  );
}

export function subscribeToHostSecret(
  roomCode: string,
  onData: (secret: HostSecretState | null) => void,
  onError: (err: Error) => void,
) {
  const path = `rooms/${roomCode}/hostState/secret`;
  return onSnapshot(
    doc(db, 'rooms', roomCode, 'hostState', 'secret'),
    (snap) => {
      onData(snap.exists() ? (snap.data() as HostSecretState) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    },
  );
}

export function subscribeToRoomPlayersForHost(
  roomCode: string,
  hostUid: string,
  onData: (players: PlayerData[]) => void,
  onError: (err: Error) => void,
) {
  const path = `rooms/${roomCode}/players`;
  const q = query(collection(db, 'rooms', roomCode, 'players'), where('hostUid', '==', hostUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as PlayerData);
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    },
  );
}

export function subscribeToSinglePlayer(
  roomCode: string,
  playerUid: string,
  onData: (player: PlayerData | null) => void,
  onError: (err: Error) => void,
) {
  const path = `rooms/${roomCode}/players/${playerUid}`;
  return onSnapshot(
    doc(db, 'rooms', roomCode, 'players', playerUid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as PlayerData) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    },
  );
}

export function subscribeToClaimsForHost(
  roomCode: string,
  hostUid: string,
  onData: (claims: WinnerClaim[]) => void,
  onError: (err: Error) => void,
) {
  const path = `rooms/${roomCode}/claims`;
  const q = query(collection(db, 'rooms', roomCode, 'claims'), where('hostUid', '==', hostUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as WinnerClaim);
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    },
  );
}

export function subscribeToClaimsForPlayer(
  roomCode: string,
  playerUid: string,
  onData: (claims: WinnerClaim[]) => void,
  onError: (err: Error) => void,
) {
  const path = `rooms/${roomCode}/claims`;
  const q = query(collection(db, 'rooms', roomCode, 'claims'), where('playerUid', '==', playerUid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as WinnerClaim);
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    },
  );
}

export function subscribeToRoomWinners(
  roomCode: string,
  onData: (winners: WinnerRecord[]) => void,
  onError: (err: Error) => void,
) {
  const path = `rooms/${roomCode}/winners`;
  const q = query(collection(db, 'rooms', roomCode, 'winners'), where('roomId', '==', roomCode));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as WinnerRecord)
        .sort((a, b) => a.approvedAtMs - b.approvedAtMs || a.id.localeCompare(b.id));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped as Error);
      }
    },
  );
}
