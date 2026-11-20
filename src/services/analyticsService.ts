import type { User } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase.ts';

const LOCAL_VISITOR_KEY = 'mh_visitor_key_v1';
const LOCAL_VISITOR_COUNTED_KEY = 'mh_visitor_counted_v1';
const PRESENCE_HEARTBEAT_MS = 45_000;

export interface DeveloperAnalyticsMetrics {
  totalUniqueVisitors: number;
  totalRegisteredUsers: number;
  totalAppOpens: number;
  todaysVisitors: number;
  todaysAppOpens: number;
  monthlyVisitors: number;
  monthlyAppOpens: number;
  currentlyOnlineUsers: number;
  totalGamesPlayed: number;
  totalCompletedGames: number;
  totalPlayersParticipated: number;
}

export interface DeveloperAnalyticsPayload {
  metrics: DeveloperAnalyticsMetrics;
  dateKey: string;
  monthKey: string;
  generatedAt: string;
}

export class AnalyticsAccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AnalyticsAccessError';
    this.status = status;
  }
}

export function getUtcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function getUtcMonthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function getOrCreatePersistentVisitorKey(): string {
  if (typeof window === 'undefined') {
    return `anon_${Date.now().toString(36)}`;
  }
  try {
    const existing = window.localStorage.getItem(LOCAL_VISITOR_KEY);
    if (existing && existing.length >= 8 && existing.length <= 120) {
      return existing;
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `anon_${crypto.randomUUID()}`
        : `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(LOCAL_VISITOR_KEY, generated);
    return generated;
  } catch {
    return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function hasLocalVisitorBeenCounted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOCAL_VISITOR_COUNTED_KEY) === '1';
  } catch {
    return false;
  }
}

function markLocalVisitorCounted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_VISITOR_COUNTED_KEY, '1');
  } catch {
    // Ignore storage write errors in restricted browsing modes
  }
}

// Track UIDs already processed during the current page load to prevent React StrictMode double-counting
const recordedInPageSession = new Map<string, boolean>();
const inFlightRecordPromises = new Map<string, Promise<{ countedUnique: boolean }>>();

/**
 * Subscribe to the public aggregated total unique visitor count ONLY.
 * Never reads or exposes user details, online users, game stats, or private analytics.
 */
export function subscribeToPublicVisitorCount(
  onData: (totalUniqueVisitors: number) => void,
  onError?: (err: Error) => void,
): () => void {
  if (!isFirebaseConfigured || !db) {
    onData(0);
    return () => {};
  }

  const ref = doc(db, 'publicStats', 'visitors');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(0);
        return;
      }
      const raw = snap.data()?.totalUniqueVisitors;
      const parsed = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      onData(parsed);
    },
    (err) => {
      if (onError) onError(err);
    },
  );
}

/**
 * Record an authenticated visitor session (anonymous or registered).
 * - Counts each unique visitor ONCE (persistent visitor ID + Firestore analyticsVisitors/{uid}).
 * - Repeated page refreshes increment appOpens only, NEVER unique visitors.
 * - For registered users, tracks stable account ID and counts registered users once.
 */
export async function recordVisitorSession(user: User): Promise<{ countedUnique: boolean }> {
  if (!isFirebaseConfigured || !db || !user?.uid) {
    return { countedUnique: false };
  }

  const isRegistered = Boolean(!user.isAnonymous && user.email);
  const sessionKey = `${user.uid}:${isRegistered ? 'reg' : 'anon'}`;

  if (recordedInPageSession.get(sessionKey)) {
    return { countedUnique: false };
  }
  const existingFlight = inFlightRecordPromises.get(sessionKey);
  if (existingFlight) {
    return existingFlight;
  }

  const task = (async (): Promise<{ countedUnique: boolean }> => {
    const todayKey = getUtcDateKey();
    const monthKey = getUtcMonthKey();
    const visitorKey = isRegistered ? `account:${user.uid}` : getOrCreatePersistentVisitorKey();

    const visitorRef = doc(db, 'analyticsVisitors', user.uid);
    const publicStatsRef = doc(db, 'publicStats', 'visitors');
    const summaryRef = doc(db, 'analyticsSummary', 'global');
    const dailyRef = doc(db, 'analyticsDaily', todayKey);
    const monthlyRef = doc(db, 'analyticsMonthly', monthKey);

    const existingSnap = await getDoc(visitorRef);
    const exists = existingSnap.exists();
    const existingData = exists ? existingSnap.data() : null;

    const alreadyCountedLocally = hasLocalVisitorBeenCounted();
    const shouldIncrementUnique = !exists && !alreadyCountedLocally;
    const shouldIncrementRegistered =
      isRegistered && (!exists || existingData?.isRegistered !== true);
    const shouldIncrementDailyUnique =
      !exists || existingData?.lastVisitDateKey !== todayKey;
    const shouldIncrementMonthlyUnique =
      !exists || existingData?.lastVisitMonthKey !== monthKey;

    const batch = writeBatch(db);

    if (!exists) {
      batch.set(visitorRef, {
        uid: user.uid,
        visitorKey,
        isRegistered,
        visitCount: 1,
        lastVisitDateKey: todayKey,
        lastVisitMonthKey: monthKey,
        firstVisitAt: serverTimestamp(),
        lastVisitAt: serverTimestamp(),
      });
    } else {
      batch.update(visitorRef, {
        visitorKey,
        isRegistered: Boolean(existingData?.isRegistered || isRegistered),
        visitCount: increment(1),
        lastVisitDateKey: todayKey,
        lastVisitMonthKey: monthKey,
        lastVisitAt: serverTimestamp(),
      });
    }

    if (shouldIncrementUnique) {
      batch.set(
        publicStatsRef,
        {
          totalUniqueVisitors: increment(1),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    batch.set(
      summaryRef,
      {
        totalUniqueVisitors: increment(shouldIncrementUnique ? 1 : 0),
        totalRegisteredUsers: increment(shouldIncrementRegistered ? 1 : 0),
        totalAppOpens: increment(1),
        totalGamesPlayed: increment(0),
        totalCompletedGames: increment(0),
        totalPlayersParticipated: increment(0),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      dailyRef,
      {
        dateKey: todayKey,
        uniqueVisitors: increment(shouldIncrementDailyUnique ? 1 : 0),
        appOpens: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      monthlyRef,
      {
        monthKey,
        uniqueVisitors: increment(shouldIncrementMonthlyUnique ? 1 : 0),
        appOpens: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();

    recordedInPageSession.set(sessionKey, true);
    markLocalVisitorCounted();

    return { countedUnique: shouldIncrementUnique };
  })();

  inFlightRecordPromises.set(sessionKey, task);
  try {
    return await task;
  } finally {
    inFlightRecordPromises.delete(sessionKey);
  }
}

/**
 * Maintain a lightweight private online-presence heartbeat for the developer dashboard.
 * Normal users can only write/delete their own heartbeat document and cannot read others.
 */
export function startPresenceHeartbeat(uid: string, isRegistered: boolean): () => void {
  if (!isFirebaseConfigured || !db || !uid) {
    return () => {};
  }

  let stopped = false;
  const presenceRef = doc(db, 'analyticsPresence', uid);

  const sendBeat = () => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    setDoc(
      presenceRef,
      {
        uid,
        isRegistered,
        lastActiveAt: serverTimestamp(),
      },
      { merge: true },
    ).catch(() => {});
  };

  sendBeat();
  const intervalId = window.setInterval(sendBeat, PRESENCE_HEARTBEAT_MS);

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      sendBeat();
    }
  };
  const handlePageHide = () => {
    deleteDoc(presenceRef).catch(() => {});
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handlePageHide);
    deleteDoc(presenceRef).catch(() => {});
  };
}

/**
 * Increment backend game-start counters when a Musical Housie game starts and deals tickets.
 */
export async function recordGameStartedAnalytics(playerCount: number): Promise<void> {
  if (!isFirebaseConfigured || !db || !auth?.currentUser) return;
  const safePlayers = Math.max(0, Math.min(10000, Math.floor(playerCount)));
  await setDoc(
    doc(db, 'analyticsSummary', 'global'),
    {
      totalUniqueVisitors: increment(0),
      totalRegisteredUsers: increment(0),
      totalAppOpens: increment(0),
      totalGamesPlayed: increment(1),
      totalCompletedGames: increment(0),
      totalPlayersParticipated: increment(safePlayers),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Increment backend completed-games counter when a host ends a live game session.
 */
export async function recordGameCompletedAnalytics(): Promise<void> {
  if (!isFirebaseConfigured || !db || !auth?.currentUser) return;
  await setDoc(
    doc(db, 'analyticsSummary', 'global'),
    {
      totalUniqueVisitors: increment(0),
      totalRegisteredUsers: increment(0),
      totalAppOpens: increment(0),
      totalGamesPlayed: increment(0),
      totalCompletedGames: increment(1),
      totalPlayersParticipated: increment(0),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Fetch private developer-only analytics from the backend-validated /api/admin/analytics route.
 */
export async function fetchDeveloperAnalytics(): Promise<DeveloperAnalyticsPayload> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new AnalyticsAccessError(401, 'Please sign in with your authorized developer account.');
  }

  const idToken = await currentUser.getIdToken(true);
  const resp = await fetch('/api/admin/analytics', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    metrics?: DeveloperAnalyticsMetrics;
    dateKey?: string;
    monthKey?: string;
    generatedAt?: string;
    error?: string;
  };

  if (!resp.ok || !data.metrics) {
    throw new AnalyticsAccessError(
      resp.status || 403,
      data.error || 'Access denied. Developer analytics are restricted to authorized administrators.',
    );
  }

  return {
    metrics: data.metrics,
    dateKey: data.dateKey || getUtcDateKey(),
    monthKey: data.monthKey || getUtcMonthKey(),
    generatedAt: data.generatedAt || new Date().toISOString(),
  };
}
