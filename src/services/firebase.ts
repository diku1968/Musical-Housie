import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithPopup,
} from 'firebase/auth';
import {
  Firestore,
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import rawConfig from '../../firebase-applet-config.json';

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const firebaseConfig = rawConfig as FirebaseAppletConfig;

export const isFirebaseConfigured = Boolean(
  firebaseConfig &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'remixed-project-id' &&
    firebaseConfig.apiKey &&
    firebaseConfig.appId,
);

export const firebaseProjectId = firebaseConfig?.projectId || '';
export const firebaseApiKey = firebaseConfig?.apiKey || '';

let app: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  const databaseId = firebaseConfig.firestoreDatabaseId || undefined;
  try {
    // Auto-detect long-polling prevents Firestore WebChannel from hanging on iOS Safari,
    // iCloud Private Relay, cellular networks, and in-app browsers (WhatsApp/Camera).
    dbInstance = databaseId
      ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, databaseId)
      : initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    dbInstance = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }

  // Avoid indexedDBLocalPersistence which frequently stalls or fails on iOS Safari / WebKit
  // (especially from QR camera links, in-app browsers, or private browsing).
  try {
    authInstance = initializeAuth(app, {
      persistence: [browserLocalPersistence, inMemoryPersistence],
    });
  } catch {
    try {
      authInstance = initializeAuth(app, {
        persistence: inMemoryPersistence,
      });
    } catch {
      authInstance = getAuth(app);
    }
  }
}

export const db = dbInstance as Firestore;
export const auth = authInstance as Auth;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const currentUser = authInstance?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    }),
  ]);
}

export async function testFirestoreConnection(): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseConfigured || !dbInstance) {
    return { ok: false, error: 'Firebase configuration is missing.' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      error: 'You appear to be offline. Please check your internet connection and tap Retry.',
    };
  }
  try {
    await raceWithTimeout(
      getDocFromServer(doc(dbInstance, 'test', 'connection')),
      4500,
      'FIRESTORE_CHECK_TIMEOUT',
    );
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg === 'FIRESTORE_CHECK_TIMEOUT') {
      // Do not permanently block boot on iOS Safari if initial WebChannel handshake is slow;
      // allow the UI to load so auth & room actions can complete over long-polling.
      return { ok: true };
    }
    if (msg.includes('the client is offline')) {
      return {
        ok: false,
        error: 'Unable to reach Firestore. Please check your internet connection and try again.',
      };
    }
    // permission-denied on test/connection confirms live server reachability
    return { ok: true };
  }
}

export interface AuthEnsureResult {
  user: User | null;
  needsAnonymousAuthSetup: boolean;
  error?: string;
}

function isAnonymousDisabledError(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/admin-restricted-operation' ||
    message.includes('operation-not-allowed') ||
    message.includes('admin-restricted-operation')
  );
}

let inFlightAuthPromise: Promise<AuthEnsureResult> | null = null;

async function runEnsureAnonymousAuth(): Promise<AuthEnsureResult> {
  if (!isFirebaseConfigured || !authInstance) {
    return {
      user: null,
      needsAnonymousAuthSetup: false,
      error: 'Firebase is not configured.',
    };
  }

  if (authInstance.currentUser) {
    return { user: authInstance.currentUser, needsAnonymousAuthSetup: false };
  }

  // Wait for Firebase Auth persistence hydration using authStateReady() with a safety timeout
  let hydrationTimer: ReturnType<typeof setTimeout> | undefined;
  let hydrationUnsub: (() => void) | undefined;
  try {
    await Promise.race([
      authInstance.authStateReady(),
      new Promise<void>((resolve) => {
        hydrationTimer = setTimeout(resolve, 2000);
        hydrationUnsub = onAuthStateChanged(authInstance!, (u) => {
          if (u) resolve();
        });
      }),
    ]);
  } catch {
    // Ignore hydration errors (e.g., blocked Safari storage) and continue to signInAnonymously
  } finally {
    if (hydrationTimer) clearTimeout(hydrationTimer);
    if (hydrationUnsub) hydrationUnsub();
  }

  if (authInstance.currentUser) {
    return { user: authInstance.currentUser, needsAnonymousAuthSetup: false };
  }

  try {
    const cred = await raceWithTimeout(
      signInAnonymously(authInstance),
      7000,
      'Session startup timed out on first attempt.',
    );
    if (cred.user) {
      return { user: cred.user, needsAnonymousAuthSetup: false };
    }
  } catch (error) {
    if (isAnonymousDisabledError(error)) {
      return {
        user: null,
        needsAnonymousAuthSetup: true,
        error: 'Anonymous Authentication is not enabled in your Firebase Console yet.',
      };
    }
    // Fall through to inMemoryPersistence retry below (handles blocked storage on iOS Safari)
  }

  // Fallback for iOS Safari / restricted browsers where persistent storage fails or stalls
  try {
    await raceWithTimeout(
      setPersistence(authInstance, inMemoryPersistence),
      2500,
      'Persistence switch timed out.',
    );
  } catch {
    // Continue even if setPersistence throws
  }

  try {
    const retryCred = await raceWithTimeout(
      signInAnonymously(authInstance),
      7000,
      'Authentication timed out. On iPhone, please open this link directly in Safari and check your internet connection.',
    );
    if (retryCred.user) {
      return { user: retryCred.user, needsAnonymousAuthSetup: false };
    }
  } catch (retryError) {
    if (isAnonymousDisabledError(retryError)) {
      return {
        user: null,
        needsAnonymousAuthSetup: true,
        error: 'Anonymous Authentication is not enabled in your Firebase Console yet.',
      };
    }
    const message = retryError instanceof Error ? retryError.message : String(retryError);
    return {
      user: null,
      needsAnonymousAuthSetup: false,
      error: message,
    };
  }

  return {
    user: authInstance.currentUser,
    needsAnonymousAuthSetup: false,
    error: authInstance.currentUser ? undefined : 'Unable to establish an anonymous session.',
  };
}

export async function ensureAnonymousAuth(): Promise<AuthEnsureResult> {
  if (authInstance?.currentUser) {
    return { user: authInstance.currentUser, needsAnonymousAuthSetup: false };
  }
  if (inFlightAuthPromise) {
    return inFlightAuthPromise;
  }
  inFlightAuthPromise = runEnsureAnonymousAuth().finally(() => {
    inFlightAuthPromise = null;
  });
  return inFlightAuthPromise;
}

export async function signInWithGoogleFallback(): Promise<User> {
  if (!authInstance) {
    throw new Error('Firebase Auth is not initialized.');
  }
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(authInstance, provider);
  return cred.user;
}

export async function getCurrentIdToken(): Promise<string | null> {
  if (!authInstance?.currentUser) return null;
  try {
    return await authInstance.currentUser.getIdToken();
  } catch {
    return null;
  }
}
