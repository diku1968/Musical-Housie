import { PATTERN_LABELS } from './types.ts';
import type {
  ClaimVerificationResult,
  TicketCell,
  TrackItem,
  WinningPattern,
} from './types.ts';

export function shuffleArray<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function decodeRepeatedly(value: string): string {
  let current = value;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

export function extractFirstUrlFromInput(inputUrl: string): string | null {
  const trimmed = inputUrl.trim();
  if (!trimmed) return null;

  const fullUrlMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  if (fullUrlMatch) {
    return fullUrlMatch[0].replace(/[),.;!?]+$/, '');
  }

  const schemelessMatch = trimmed.match(
    /(?:(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|yt\.be|youtube\.app\.goo\.gl|goo\.gl)\/[^\s"'<>]+)/i,
  );
  if (schemelessMatch) {
    return `https://${schemelessMatch[0].replace(/[),.;!?]+$/, '')}`;
  }

  return null;
}

export function normalizeYouTubePlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

export function extractYouTubePlaylistId(inputUrl: string, depth = 0): string | null {
  if (depth > 2) return null;
  const trimmed = inputUrl.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  const candidateUrl = extractFirstUrlFromInput(trimmed) || trimmed;

  try {
    const withScheme = /^[a-zA-Z]+:\/\//.test(candidateUrl)
      ? candidateUrl
      : `https://${candidateUrl}`;
    const url = new URL(withScheme);

    // Unwrap Google redirect links sometimes produced by mobile browsers/apps
    if (url.hostname.includes('google.') && url.searchParams.get('q')) {
      const nested = extractYouTubePlaylistId(url.searchParams.get('q') || '', depth + 1);
      if (nested) return nested;
    }

    const listParam = url.searchParams.get('list');
    if (listParam && /^[a-zA-Z0-9_-]{2,}$/.test(listParam)) {
      return listParam;
    }

    // Handle mobile redirect links containing nested continue/url parameters
    for (const key of ['continue', 'url', 'u', 'next']) {
      const nestedVal = url.searchParams.get(key);
      if (nestedVal) {
        const nested = extractYouTubePlaylistId(decodeRepeatedly(nestedVal), depth + 1);
        if (nested) return nested;
      }
    }
  } catch {
    // Fall through to regex extraction
  }

  const decoded = decodeRepeatedly(trimmed);
  const regexMatch = decoded.match(/(?:[?&#]|&amp;)list=([a-zA-Z0-9_-]{2,})/i);
  if (regexMatch && regexMatch[1]) {
    return regexMatch[1];
  }

  return null;
}

export function buildTrackSongNumberMap(tracks: readonly TrackItem[]): Map<string, number> {
  const numberMap = new Map<string, number>();
  let nextNumber = 1;
  for (const track of tracks) {
    if (!numberMap.has(track.id)) {
      numberMap.set(track.id, nextNumber);
      nextNumber += 1;
    }
  }
  return numberMap;
}

export function generateUniqueTickets(
  tracks: TrackItem[],
  playerUids: string[],
): Record<string, TicketCell[]> {
  if (tracks.length < 15) {
    throw new Error(
      `At least 15 accessible songs are required to generate 3x5 tickets (found ${tracks.length}).`,
    );
  }

  // Deduplicate tracks by id just in case a playlist contains duplicate entries
  const uniqueMap = new Map<string, TrackItem>();
  for (const track of tracks) {
    if (!uniqueMap.has(track.id)) {
      uniqueMap.set(track.id, track);
    }
  }
  const uniqueTracks = Array.from(uniqueMap.values());
  if (uniqueTracks.length < 15) {
    throw new Error(
      `At least 15 unique songs are required to generate tickets (found ${uniqueTracks.length} unique songs).`,
    );
  }

  const songNumberById = buildTrackSongNumberMap(uniqueTracks);
  const ticketsByPlayer: Record<string, TicketCell[]> = {};
  const seenSignatures = new Set<string>();
  const seenOrderSignatures = new Set<string>();

  for (const uid of playerUids) {
    let chosen: TrackItem[] = [];
    for (let attempt = 0; attempt < 250; attempt++) {
      const candidate = shuffleArray(uniqueTracks).slice(0, 15);
      const setSig = candidate
        .map((t) => t.id)
        .sort()
        .join('|');
      const orderSig = candidate.map((t) => t.id).join('|');

      // Prefer distinct 15-song subsets when playlist has >= 16 songs
      if (uniqueTracks.length >= 16) {
        if (!seenSignatures.has(setSig)) {
          chosen = candidate;
          seenSignatures.add(setSig);
          seenOrderSignatures.add(orderSig);
          break;
        }
      } else if (!seenOrderSignatures.has(orderSig)) {
        chosen = candidate;
        seenOrderSignatures.add(orderSig);
        break;
      }

      if (attempt === 249) {
        chosen = candidate;
      }
    }

    ticketsByPlayer[uid] = chosen.map((t) => ({
      id: t.id,
      title: t.title.slice(0, 120),
      artist: t.artist.slice(0, 80),
      songNumber: songNumberById.get(t.id),
    }));
  }

  return ticketsByPlayer;
}

export function getPatternIndices(pattern: WinningPattern): number[] {
  switch (pattern) {
    case 'top_row':
      return [0, 1, 2, 3, 4];
    case 'middle_row':
      return [5, 6, 7, 8, 9];
    case 'bottom_row':
      return [10, 11, 12, 13, 14];
    case 'full_house':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    case 'first_five':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  }
}

export function isClientTicketReadyForPattern(
  ticket: TicketCell[],
  markedSongIds: string[],
  pattern: WinningPattern,
): boolean {
  if (ticket.length !== 15) return false;
  const markedSet = new Set(markedSongIds);
  if (pattern === 'first_five') {
    const count = ticket.filter((cell) => markedSet.has(cell.id)).length;
    return count >= 5;
  }
  const indices = getPatternIndices(pattern);
  return indices.every((idx) => markedSet.has(ticket[idx].id));
}

export function getPatternProgress(
  ticket: TicketCell[],
  markedSongIds: string[],
  pattern: WinningPattern,
): { matched: number; required: number } {
  if (ticket.length !== 15) {
    return { matched: 0, required: pattern === 'full_house' ? 15 : 5 };
  }
  const markedSet = new Set(markedSongIds);
  if (pattern === 'first_five') {
    const count = ticket.filter((cell) => markedSet.has(cell.id)).length;
    return { matched: Math.min(5, count), required: 5 };
  }
  const indices = getPatternIndices(pattern);
  const matched = indices.filter((idx) => markedSet.has(ticket[idx].id)).length;
  return { matched, required: indices.length };
}

export function formatTicketNumber(ticketNumber?: number): string {
  if (!ticketNumber || ticketNumber < 1) return '—';
  return `#${String(ticketNumber).padStart(2, '0')}`;
}

export function verifyClaimAgainstPlayedSongs(
  ticket: TicketCell[],
  claimedSongIds: string[],
  officiallyPlayedIds: string[],
  pattern: WinningPattern,
): ClaimVerificationResult {
  if (ticket.length !== 15) {
    return {
      isValid: false,
      pattern,
      matchedPlayedIds: [],
      uncalledMarkedIds: claimedSongIds,
      missingRequiredIds: [],
      summary: 'Invalid ticket structure (expected 15 songs).',
    };
  }

  const ticketIds = new Set(ticket.map((c) => c.id));
  const playedSet = new Set(officiallyPlayedIds);
  const claimedSet = new Set(claimedSongIds.filter((id) => ticketIds.has(id)));

  if (pattern === 'first_five') {
    const matchedPlayedIds: string[] = [];
    const uncalledMarkedIds: string[] = [];

    for (const id of claimedSet) {
      if (playedSet.has(id)) {
        matchedPlayedIds.push(id);
      } else {
        uncalledMarkedIds.push(id);
      }
    }

    if (uncalledMarkedIds.length > 0) {
      const uncalledTitles = uncalledMarkedIds
        .map((id) => ticket.find((c) => c.id === id)?.title || id)
        .slice(0, 3)
        .join(', ');
      return {
        isValid: false,
        pattern,
        matchedPlayedIds,
        uncalledMarkedIds,
        missingRequiredIds: [],
        summary: `Rejected: ${uncalledMarkedIds.length} marked song(s) have not been officially played (${uncalledTitles}).`,
      };
    }

    const isValid = matchedPlayedIds.length >= 5;
    return {
      isValid,
      pattern,
      matchedPlayedIds,
      uncalledMarkedIds: [],
      missingRequiredIds: [],
      summary: isValid
        ? `Verified ${PATTERN_LABELS[pattern]}: ${matchedPlayedIds.length} officially played songs matched.`
        : `Incomplete ${PATTERN_LABELS[pattern]}: only ${matchedPlayedIds.length} of 5 songs officially played.`,
    };
  }

  // Row and Full House patterns validate strictly against the cells belonging to that pattern
  const requiredIndices = getPatternIndices(pattern);
  const missingRequiredIds: string[] = [];
  const patternMatchedIds: string[] = [];
  const uncalledInPatternIds: string[] = [];

  for (const idx of requiredIndices) {
    const cell = ticket[idx];
    const isMarked = claimedSet.has(cell.id);
    const isPlayed = playedSet.has(cell.id);
    if (isMarked && isPlayed) {
      patternMatchedIds.push(cell.id);
    } else {
      if (isMarked && !isPlayed) {
        uncalledInPatternIds.push(cell.id);
      }
      missingRequiredIds.push(cell.id);
    }
  }

  if (uncalledInPatternIds.length > 0) {
    const uncalledTitles = uncalledInPatternIds
      .map((id) => ticket.find((c) => c.id === id)?.title || id)
      .slice(0, 3)
      .join(', ');
    return {
      isValid: false,
      pattern,
      matchedPlayedIds: patternMatchedIds,
      uncalledMarkedIds: uncalledInPatternIds,
      missingRequiredIds,
      summary: `Rejected: ${uncalledInPatternIds.length} marked song(s) in ${PATTERN_LABELS[pattern]} have not been officially played (${uncalledTitles}).`,
    };
  }

  const isValid = missingRequiredIds.length === 0;
  return {
    isValid,
    pattern,
    matchedPlayedIds: patternMatchedIds,
    uncalledMarkedIds: [],
    missingRequiredIds,
    summary: isValid
      ? `Verified ${PATTERN_LABELS[pattern]}: ${patternMatchedIds.length}/${requiredIndices.length} required songs officially played.`
      : `Incomplete ${PATTERN_LABELS[pattern]}: missing ${missingRequiredIds.length} officially played song(s) in pattern.`,
  };
}
