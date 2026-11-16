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
import { generateRoomCode, shuffleArray } from '../shared/gameLogic.ts';
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

export interface SavedSession {
  roomCode: string;
  role: 'host' | 'player';
  name: string;
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
      // Skip non-fatal cleanup errors so callers can continue
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

  // Free database space by removing ended, expired, or abandoned previous rooms from this host
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
      // If expired, host cannot overwrite someone else's doc; try another code
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
    throw new Error(`No game room found with code "${roomCode}". Please double-check the code.`);
  }

  const room = roomSnap.data() as RoomData;
  const expiresMs =
    room.expiresAt && typeof (room.expiresAt as Timestamp).toMillis === 'function'
      ? (room.expiresAt as Timestamp).toMillis()
      : Date.now() + 10000;

  if (expiresMs < Date.now()) {
    throw new Error(`Room ${roomCode} has expired. Ask the host to create a fresh game.`);
  }

  // If the current browser user IS the host rejoining their own room
  if (room.hostUid === user.uid) {
    saveLocalSession({ roomCode, role: 'host', name: room.hostName });
    return { roomCode, role: 'host' };
  }

  if (room.status === 'ended') {
    throw new Error(`Game ${roomCode} has already ended.`);
  }

  const playerRef = doc(db, 'rooms', roomCode, 'players', user.uid);
  let playerSnap;
  try {
    playerSnap = await getDoc(playerRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `rooms/${roomCode}/players/${user.uid}`);
  }

  if (playerSnap.exists()) {
    // Reconnecting player
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
    saveLocalSession({ roomCode, role: 'player', name: cleanName });
    return { roomCode, role: 'player' };
  }

  if (room.status !== 'lobby') {
    throw new Error(
      `Game ${roomCode} is already in progress. Players must join in the lobby before tickets are dealt.`,
    );
  }

  const duplicateName = (room.playersSummary || []).some(
    (p) => p.uid !== user.uid && p.name.trim().toLowerCase() === cleanName.toLowerCase(),
  );
  if (duplicateName) {
    throw new Error(
      `A player named "${cleanName}" is already in this room. Please use a unique name or add your last initial.`,
    );
  }

  const currentCount = Math.max(room.playersSummary?.length || 0, room.playerCount || 0);
  if (currentCount >= 100) {
    throw new Error(`Room ${roomCode} is full (maximum 100 players).`);
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
      playerCount: summary.length,
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

  // Deterministic player ordering by join timestamp so ticket numbers are stable
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

  // Generate unique 3x5 tickets and sequential ticket numbers on the server
  const ticketResp = await fetch('/api/game/generate-tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tracks,
      playerUids: orderedPlayers.map((p) => p.uid),
    }),
  });
  const ticketJson = (await ticketResp.json()) as {
    ticketsByPlayer?: Record<string, TicketCell[]>;
    ticketNumbersByPlayer?: Record<string, number>;
    error?: string;
  };
  if (!ticketResp.ok || !ticketJson.ticketsByPlayer) {
    throw new Error(ticketJson.error || 'Failed to generate player tickets.');
  }

  const orderedTracks = randomMode ? shuffleArray(tracks) : [...tracks];
  const queueOrder = orderedTracks.map((t) => t.id);
  const firstSongId = queueOrder[0];

  const batch = writeBatch(db);
  orderedPlayers.forEach((player, index) => {
    const assignedTicket = ticketJson.ticketsByPlayer![player.uid];
    if (!assignedTicket || assignedTicket.length !== 15) {
      throw new Error(`Failed to allocate 15-song ticket for ${player.name}.`);
    }
    const ticketNumber = ticketJson.ticketNumbersByPlayer?.[player.uid] ?? index + 1;
    batch.update(doc(db, 'rooms', roomCode, 'players', player.uid), {
      ticket: assignedTicket,
      ticketNumber,
      markedSongIds: [],
      lastSeenAt: serverTimestamp(),
    });
  });

  batch.update(doc(db, 'rooms', roomCode, 'hostState', 'secret'), {
    hostUid,
    queueOrder,
    currentSongId: firstSongId,
    playedSongIds: [firstSongId],
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'rooms', roomCode), {
    status: 'playing',
    currentSongNumber: 1,
    currentSongRevealed: false,
    currentMedia: toCurrentMedia(orderedTracks[0]),
    revealedCurrentSong: { id: '', title: '', artist: '', sourceId: '' },
    revealedSongs: [],
    randomMode,
    enabledPatterns,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `rooms/${roomCode}`);
  }
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

  // Add the finished previous song to revealedSongs so players can review past songs
  const nextRevealedSongs: RevealedSong[] = [...(room.revealedSongs || [])];
  if (currentTrack && !nextRevealedSongs.some((s) => s.id === currentTrack.id)) {
    nextRevealedSongs.push({
      id: currentTrack.id,
      title: currentTrack.title.slice(0, 120),
      artist: currentTrack.artist.slice(0, 80),
      sourceId: currentTrack.sourceId,
    });
  }

  const nextIdx = currentIdx + 1;
  if (nextIdx >= secret.queueOrder.length) {
    // Playlist exhausted
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
      updatedAt: serverTimestamp(),
    });
    return { finishedPlaylist: true };
  }

  const nextSongId = secret.queueOrder[nextIdx];
  const nextTrack = secret.tracks.find((t) => t.id === nextSongId) || null;
  const updatedPlayedIds = secret.playedSongIds.includes(nextSongId)
    ? secret.playedSongIds
    : [...secret.playedSongIds, nextSongId];

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

  // Enforce unique player + pattern per game session: reject if this player already won this pattern
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

  if (existingSnap.exists()) {
    const existing = existingSnap.data() as WinnerClaim;
    if (existing.status === 'pending') {
      throw new Error('Your claim for this pattern is already pending server verification.');
    }
    if (existing.status === 'approved') {
      throw new Error(`You have already won ${PATTERN_LABELS[pattern]} in this game.`);
    }
    // Rejected previously -> allow clean resubmission
    try {
      await updateDoc(claimRef, {
        status: 'pending',
        ticketNumber,
        claimedSongIds: player.markedSongIds,
        ticketSnapshot: player.ticket,
        claimedAtMs,
        verifiedMatchedIds: [],
        verificationSummary: 'Verifying claim against official played songs on server...',
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
      claimedSongIds: player.markedSongIds,
      ticketSnapshot: player.ticket,
      claimedAtMs,
      status: 'pending',
      verifiedMatchedIds: [],
      verificationSummary: 'Verifying claim against official played songs on server...',
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
  const user = await requireAuthenticatedUser();
  const idToken = await user.getIdToken();

  const resp = await fetch('/api/game/verify-claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ roomCode, claimId }),
  });

  const data = (await resp.json()) as {
    ok?: boolean;
    verification?: ClaimVerificationResult;
    ticketNumber?: number;
    serverProcessedAtMs?: number;
    error?: string;
  };
  if (!resp.ok || !data.verification) {
    throw new Error(data.error || 'Server verification failed.');
  }
  return {
    ...data.verification,
    ticketNumber: data.ticketNumber ?? data.verification.ticketNumber,
    serverProcessedAtMs: data.serverProcessedAtMs ?? data.verification.serverProcessedAtMs,
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

      // Enforce unique (gameSessionId + patternId + playerId) constraint
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
