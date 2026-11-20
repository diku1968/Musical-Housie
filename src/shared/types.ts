export type WinningPattern =
  | 'first_five'
  | 'top_row'
  | 'middle_row'
  | 'bottom_row'
  | 'full_house';

export type RoomStatus = 'lobby' | 'playing' | 'paused' | 'ended';
export type PlaylistSourceType = 'none' | 'youtube' | 'spotify';
export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface TrackItem {
  id: string;
  title: string;
  artist: string;
  sourceId: string;
  sourceType: 'youtube' | 'spotify';
  thumbnailUrl?: string;
  previewUrl?: string;
}

export interface ProblemTrackItem {
  position?: number;
  sourceId: string;
  title: string;
  artist?: string;
  reason: string;
}

export interface TicketCell {
  id: string;
  title: string;
  artist: string;
  songNumber?: number;
}

export interface RevealedSong {
  id: string;
  title: string;
  artist: string;
  sourceId: string;
}

export interface WinnerRecord {
  id: string;
  roomId: string;
  hostUid: string;
  claimId: string;
  playerUid: string;
  playerName: string;
  ticketNumber: number;
  pattern: WinningPattern;
  approvedAtMs: number;
  createdAt?: unknown;
}

export interface PlayerSummary {
  uid: string;
  name: string;
  isOnline: boolean;
}

export interface CurrentPlayableMedia {
  songId: string;
  sourceType: PlaylistSourceType;
  sourceId: string;
  previewUrl: string;
}

export interface RoomData {
  roomCode: string;
  gameName: string;
  hostUid: string;
  hostName: string;
  status: RoomStatus;
  sourceType: PlaylistSourceType;
  playlistName: string;
  playlistUrl: string;
  totalSongs: number;
  currentSongNumber: number;
  currentSongRevealed: boolean;
  currentMedia?: CurrentPlayableMedia;
  revealedCurrentSong: RevealedSong;
  revealedSongs: RevealedSong[];
  playedSongIds?: string[];
  playedSongNumbers?: number[];
  enabledPatterns: WinningPattern[];
  winners: WinnerRecord[];
  playersSummary: PlayerSummary[];
  randomMode: boolean;
  playerCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  expiresAt?: unknown;
}

export interface HostSecretState {
  hostUid: string;
  tracks: TrackItem[];
  queueOrder: string[];
  currentSongId: string;
  playedSongIds: string[];
  updatedAt?: unknown;
}

export interface PlayerData {
  uid: string;
  roomId: string;
  hostUid: string;
  name: string;
  isOnline: boolean;
  ticket: TicketCell[];
  ticketNumber: number;
  markedSongIds: string[];
  joinedAt?: unknown;
  lastSeenAt?: unknown;
}

export interface WinnerClaim {
  id: string;
  roomId: string;
  hostUid: string;
  playerUid: string;
  playerName: string;
  ticketNumber: number;
  pattern: WinningPattern;
  claimedSongIds: string[];
  ticketSnapshot: TicketCell[];
  claimedAtMs: number;
  status: ClaimStatus;
  verifiedMatchedIds: string[];
  verificationSummary: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClaimVerificationResult {
  isValid: boolean;
  pattern: WinningPattern;
  matchedPlayedIds: string[];
  uncalledMarkedIds: string[];
  missingRequiredIds: string[];
  summary: string;
  alreadyWonByPlayer?: boolean;
  ticketNumber?: number;
  serverProcessedAtMs?: number;
}

export const PATTERN_LABELS: Record<WinningPattern, string> = {
  first_five: 'First Five',
  top_row: 'Top Row',
  middle_row: 'Middle Row',
  bottom_row: 'Bottom Row',
  full_house: 'Full House',
};

export const PATTERN_DESCRIPTIONS: Record<WinningPattern, string> = {
  first_five: 'Any 5 officially played songs marked on your ticket',
  top_row: 'All 5 songs in the top row (Row 1) marked',
  middle_row: 'All 5 songs in the middle row (Row 2) marked',
  bottom_row: 'All 5 songs in the bottom row (Row 3) marked',
  full_house: 'All 15 songs across the entire ticket marked',
};

export const ALL_PATTERNS: WinningPattern[] = [
  'first_five',
  'top_row',
  'middle_row',
  'bottom_row',
  'full_house',
];
