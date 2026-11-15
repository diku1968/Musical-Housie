# Musical Housie — Firestore Security Specification

## 1. Data Invariants
1. **Room Ownership**: Only `hostUid == request.auth.uid` can create a room with their own UID, mutate game progression (`status`, `playlistName`, `currentSongNumber`, `revealedCurrentSong`, `winners`), or end a game.
2. **Secret Isolation**: `/rooms/{roomId}/hostState/secret` is strictly readable and writable ONLY by the room's `hostUid`. Players can never read uncalled tracks, queue order, or the unrevealed current song.
3. **Player Self-Service Boundaries**: A player can only create `/rooms/{roomId}/players/{playerUid}` where `playerUid == request.auth.uid`, and can only update their own `markedSongIds`, `isOnline`, `lastSeenAt`, or lobby `name`. Players cannot modify their own `ticket` once assigned.
4. **Zero Client-Side Winner Trust**: A player can only create a claim with `status == 'pending'` and `verifiedMatchedIds == []`. Only the host can transition a claim to `'approved'` or `'rejected'` and record verified song matches.
5. **Terminal State Locking**: Once a room reaches `status == 'ended'`, no further gameplay mutations, new players, ticket markings, or claims are permitted.
6. **Temporal Integrity**: `createdAt`, `updatedAt`, `joinedAt`, and `lastSeenAt` must strictly equal `request.time`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Identity Spoofing on Room Create**: Create `/rooms/ABC123` with `hostUid: "victim_uid"` as `"attacker_uid"`. -> `PERMISSION_DENIED`
2. **Ghost Field Shadow Write on Room**: Create `/rooms/ABC123` with extra field `isAdmin: true`. -> `PERMISSION_DENIED`
3. **Secret Queue Peek by Player**: `get` `/rooms/ABC123/hostState/secret` as a joined player. -> `PERMISSION_DENIED`
4. **Player Self-Approving Win Claim**: Create `/rooms/ABC123/claims/p1_full_house` with `status: "approved"`. -> `PERMISSION_DENIED`
5. **Player Forging Ticket**: Update `/rooms/ABC123/players/p1` changing `ticket` array while game is playing. -> `PERMISSION_DENIED`
6. **Non-Host Advancing Song**: Update `/rooms/ABC123` changing `currentSongNumber` as a player. -> `PERMISSION_DENIED`
7. **Terminal State Mutation**: Update `/rooms/ABC123` when `existing().status == 'ended'`. -> `PERMISSION_DENIED`
8. **Resource Exhaustion / ID Poisoning**: Read or write `/rooms/VERY_LONG_POISON_ID_12345`. -> `PERMISSION_DENIED`
9. **Spoofed Timestamp**: Create `/rooms/ABC123` with `createdAt: Timestamp(0)` instead of `request.time`. -> `PERMISSION_DENIED`
10. **Collection Scraping**: `list` `/rooms` or `list` `/rooms/ABC123/players` as an outsider. -> `PERMISSION_DENIED`
11. **Duplicate Claim Bypass**: Update an `'approved'` claim back to `'pending'` or overwrite someone else's claim. -> `PERMISSION_DENIED`
12. **Orphaned Player Join**: Create `/rooms/NOPE99/players/p1` when room `NOPE99` does not exist. -> `PERMISSION_DENIED`
