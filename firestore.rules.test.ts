/**
 * Adversarial Security Rules Specification Tests (Dirty Dozen)
 * Run against Firebase Emulator Suite (@firebase/rules-unit-testing) when testing locally.
 */
export interface SecurityTestCase {
  id: number;
  name: string;
  operation: 'create' | 'update' | 'get' | 'list';
  path: string;
  expected: 'PERMISSION_DENIED';
  rationale: string;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Room Create',
    operation: 'create',
    path: '/rooms/ABC123',
    expected: 'PERMISSION_DENIED',
    rationale: 'incoming().hostUid must equal request.auth.uid',
  },
  {
    id: 2,
    name: 'Ghost Field Shadow Write on Room',
    operation: 'create',
    path: '/rooms/ABC123',
    expected: 'PERMISSION_DENIED',
    rationale: 'data.keys().hasOnly(...) rejects unapproved ghost fields',
  },
  {
    id: 3,
    name: 'Secret Queue Peek by Player',
    operation: 'get',
    path: '/rooms/ABC123/hostState/secret',
    expected: 'PERMISSION_DENIED',
    rationale: 'Only hostUid can read hostState/secret',
  },
  {
    id: 4,
    name: 'Player Self-Approving Win Claim',
    operation: 'create',
    path: '/rooms/ABC123/claims/p1_full_house',
    expected: 'PERMISSION_DENIED',
    rationale: 'Claims created by players must have status == pending and empty verifiedMatchedIds',
  },
  {
    id: 5,
    name: 'Player Forging Assigned Ticket',
    operation: 'update',
    path: '/rooms/ABC123/players/p1',
    expected: 'PERMISSION_DENIED',
    rationale: 'Players can only modify markedSongIds, isOnline, lastSeenAt, or lobby name',
  },
  {
    id: 6,
    name: 'Non-Host Advancing Song',
    operation: 'update',
    path: '/rooms/ABC123',
    expected: 'PERMISSION_DENIED',
    rationale: 'Room updates require existing().hostUid == request.auth.uid',
  },
  {
    id: 7,
    name: 'Terminal State Mutation After End Game',
    operation: 'update',
    path: '/rooms/ABC123',
    expected: 'PERMISSION_DENIED',
    rationale: 'existing().status != ended blocks all post-end mutations',
  },
  {
    id: 8,
    name: 'ID Poisoning on Room Path',
    operation: 'get',
    path: '/rooms/INVALID_POISON_ROOM_CODE',
    expected: 'PERMISSION_DENIED',
    rationale: 'isValidRoomCode enforces exact 6-character ^[A-Z0-9]{6}$ pattern',
  },
  {
    id: 9,
    name: 'Spoofed Server Timestamp',
    operation: 'create',
    path: '/rooms/ABC123',
    expected: 'PERMISSION_DENIED',
    rationale: 'createdAt and updatedAt must strictly equal request.time',
  },
  {
    id: 10,
    name: 'Unauthorized Room Collection Scraping',
    operation: 'list',
    path: '/rooms',
    expected: 'PERMISSION_DENIED',
    rationale: 'allow list: if false prevents room directory enumeration',
  },
  {
    id: 11,
    name: 'Duplicate or Mutated Approved Claim',
    operation: 'update',
    path: '/rooms/ABC123/claims/p1_top_row',
    expected: 'PERMISSION_DENIED',
    rationale: 'Approved claims cannot be reverted or overwritten; claimId locks 1 doc per player per pattern',
  },
  {
    id: 12,
    name: 'Orphaned Player Join to Missing Room',
    operation: 'create',
    path: '/rooms/NOPE99/players/p1',
    expected: 'PERMISSION_DENIED',
    rationale: 'exists(/rooms/NOPE99) and lobby status check prevent orphaned writes',
  },
];
