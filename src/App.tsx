import { onAuthStateChanged } from 'firebase/auth';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppScreen, Header } from './components/Header.tsx';
import { HomeView } from './components/HomeView.tsx';
import {
  auth,
  ensureAnonymousAuth,
  firebaseProjectId,
  isFirebaseConfigured,
  signInWithGoogleFallback,
  testFirestoreConnection,
} from './services/firebase.ts';
import {
  SavedSession,
  cleanupExpiredOrEndedHostedRooms,
  createGameRoom,
  joinGameRoom,
  leaveLobbyAsPlayer,
  loadLocalSession,
  saveLocalSession,
} from './services/gameService.ts';

const HostCreateView = lazy(() =>
  import('./components/HostCreateView.tsx').then((m) => ({ default: m.HostCreateView })),
);
const JoinRoomView = lazy(() =>
  import('./components/JoinRoomView.tsx').then((m) => ({ default: m.JoinRoomView })),
);
const HowToPlayView = lazy(() =>
  import('./components/HowToPlayView.tsx').then((m) => ({ default: m.HowToPlayView })),
);
const HostGameView = lazy(() =>
  import('./components/HostGameView.tsx').then((m) => ({ default: m.HostGameView })),
);
const PlayerGameView = lazy(() =>
  import('./components/PlayerGameView.tsx').then((m) => ({ default: m.PlayerGameView })),
);
const SetupGuideModal = lazy(() =>
  import('./components/SetupGuideModal.tsx').then((m) => ({ default: m.SetupGuideModal })),
);

interface AppHistoryState {
  screen: AppScreen;
  roomCode?: string;
  inviteRoomCode?: string;
  modal?: 'setup';
}

const VALID_STATIC_SCREENS: ReadonlySet<AppScreen> = new Set([
  'home',
  'how-to-play',
  'host-create',
  'join',
]);

function buildUrlForHistoryState(state: AppHistoryState): string {
  const base = window.location.pathname || '/';
  if (state.screen === 'join' && state.inviteRoomCode && /^[A-Z0-9]{6}$/.test(state.inviteRoomCode)) {
    return `${base}?room=${state.inviteRoomCode}`;
  }
  if (state.screen === 'home') {
    return base;
  }
  return `${base}?screen=${state.screen}`;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected application error.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Musical Housie UI error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#080B18] text-slate-100 p-6">
          <div className="max-w-md w-full rounded-3xl border border-rose-400/40 bg-[#121830] p-6 space-y-4 text-center">
            <AlertTriangle className="h-8 w-8 text-rose-400 mx-auto" />
            <h1 className="font-display text-xl font-bold text-white">Something went wrong</h1>
            <p className="text-sm text-slate-300">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <MusicalHousieApp />
    </AppErrorBoundary>
  );
}

function ScreenSuspenseFallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 flex items-center justify-center gap-3 text-slate-300">
      <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
      <span>Loading view...</span>
    </div>
  );
}

function MusicalHousieApp() {
  const [screen, setScreen] = useState<AppScreen>('home');
  const [activeRoomCode, setActiveRoomCode] = useState<string>('');
  const [inviteRoomCode, setInviteRoomCode] = useState<string>('');
  const [uid, setUid] = useState<string>('');
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);

  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [needsAnonymousAuthSetup, setNeedsAnonymousAuthSetup] = useState(false);

  const [setupModalOpen, setSetupModalOpen] = useState(false);

  // Global network / Firebase connectivity monitoring
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionVerifiedNotice, setConnectionVerifiedNotice] = useState(false);

  const inFlightConnectRef = useRef(false);
  const wasOfflineRef = useRef(typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const verifiedTimerRef = useRef<number | null>(null);

  // Refs for stable popstate listener without re-subscribing
  const screenRef = useRef<AppScreen>(screen);
  const activeRoomCodeRef = useRef<string>(activeRoomCode);
  const inviteRoomCodeRef = useRef<string>(inviteRoomCode);
  const setupModalOpenRef = useRef<boolean>(setupModalOpen);

  screenRef.current = screen;
  activeRoomCodeRef.current = activeRoomCode;
  inviteRoomCodeRef.current = inviteRoomCode;
  setupModalOpenRef.current = setupModalOpen;

  const navigateTo = useCallback(
    (
      target: AppScreen,
      options?: { roomCode?: string; inviteCode?: string; replace?: boolean },
    ) => {
      const nextRoomCode = options?.roomCode ?? (target === 'host-room' || target === 'player-room' ? activeRoomCodeRef.current : '');
      const nextInviteCode = options?.inviteCode ?? (target === 'join' ? inviteRoomCodeRef.current : '');

      const currentState = (window.history.state || {}) as Partial<AppHistoryState>;
      const sameTarget =
        currentState.screen === target &&
        (currentState.roomCode || '') === nextRoomCode &&
        (currentState.inviteRoomCode || '') === nextInviteCode &&
        !currentState.modal;

      const nextState: AppHistoryState = {
        screen: target,
        ...(nextRoomCode ? { roomCode: nextRoomCode } : {}),
        ...(nextInviteCode ? { inviteRoomCode: nextInviteCode } : {}),
      };

      const nextUrl = buildUrlForHistoryState(nextState);
      if (!sameTarget) {
        if (options?.replace) {
          window.history.replaceState(nextState, '', nextUrl);
        } else {
          window.history.pushState(nextState, '', nextUrl);
        }
      }

      if (target === 'home' && (screenRef.current === 'host-room' || screenRef.current === 'player-room')) {
        setSavedSession(loadLocalSession());
      }
      if (options?.roomCode !== undefined) {
        setActiveRoomCode(options.roomCode);
      }
      if (options?.inviteCode !== undefined) {
        setInviteRoomCode(options.inviteCode);
      }
      setScreen(target);
    },
    [],
  );

  const openSetupModal = useCallback(() => {
    setSetupModalOpen(true);
    const currentState = (window.history.state || {
      screen: screenRef.current,
      ...(activeRoomCodeRef.current ? { roomCode: activeRoomCodeRef.current } : {}),
      ...(inviteRoomCodeRef.current ? { inviteRoomCode: inviteRoomCodeRef.current } : {}),
    }) as AppHistoryState;
    if (currentState.modal !== 'setup') {
      window.history.pushState(
        { ...currentState, modal: 'setup' },
        '',
        window.location.href,
      );
    }
  }, []);

  const closeSetupModal = useCallback(() => {
    setSetupModalOpen(false);
    const currentState = window.history.state as AppHistoryState | null;
    if (currentState?.modal === 'setup') {
      window.history.back();
    }
  }, []);

  const initializeBackend = useCallback(async (opts?: { isReconnect?: boolean }) => {
    if (inFlightConnectRef.current) return;
    inFlightConnectRef.current = true;

    const isReconnect = Boolean(opts?.isReconnect);
    if (isReconnect) {
      setReconnecting(true);
    } else {
      setBooting(true);
    }
    setBootError('');

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOffline(true);
        wasOfflineRef.current = true;
        setBootError('You are offline. Connect to Wi-Fi or mobile data and tap Retry.');
        return;
      }

      if (!isFirebaseConfigured) {
        setBootError('Firebase configuration is missing.');
        return;
      }

      const conn = await testFirestoreConnection();
      if (!conn.ok) {
        setBootError(conn.error || 'Could not connect to Firestore.');
        return;
      }

      const authResult = await ensureAnonymousAuth();
      if (authResult.needsAnonymousAuthSetup) {
        setNeedsAnonymousAuthSetup(true);
        return;
      }
      if (!authResult.user) {
        setBootError(authResult.error || 'Unable to initialize Firebase session.');
        return;
      }

      setNeedsAnonymousAuthSetup(false);
      setUid(authResult.user.uid);
      setBootError('');

      if (isReconnect) {
        setConnectionVerifiedNotice(true);
        if (verifiedTimerRef.current) {
          window.clearTimeout(verifiedTimerRef.current);
        }
        verifiedTimerRef.current = window.setTimeout(() => {
          setConnectionVerifiedNotice(false);
          verifiedTimerRef.current = null;
        }, 3500);
      }

      cleanupExpiredOrEndedHostedRooms().catch(() => {});
    } finally {
      inFlightConnectRef.current = false;
      setBooting(false);
      setReconnecting(false);
    }
  }, []);

  // Initial URL/deep-link + history state setup & Firebase boot
  useEffect(() => {
    initializeBackend();

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room')?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const screenParam = params.get('screen') as AppScreen | null;

    if (roomParam && /^[A-Z0-9]{6}$/.test(roomParam)) {
      const initialState: AppHistoryState = {
        screen: 'join',
        inviteRoomCode: roomParam,
      };
      setInviteRoomCode(roomParam);
      setScreen('join');
      window.history.replaceState(initialState, '', window.location.href);
    } else if (screenParam && VALID_STATIC_SCREENS.has(screenParam) && screenParam !== 'home') {
      const initialState: AppHistoryState = { screen: screenParam };
      setSavedSession(loadLocalSession());
      setScreen(screenParam);
      window.history.replaceState(initialState, '', window.location.href);
    } else {
      const initialState: AppHistoryState = { screen: 'home' };
      setSavedSession(loadLocalSession());
      setScreen('home');
      window.history.replaceState(initialState, '', window.location.pathname || '/');
    }

    if (!auth) return;
    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUid(currentUser?.uid || '');
    });
    return () => unsubAuth();
  }, [initializeBackend]);

  // Browser History Back/Forward listener (supports Web + Android WebView)
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = (event.state || null) as AppHistoryState | null;

      // If Setup modal is currently open and popped state no longer has modal: 'setup', close modal only
      if (setupModalOpenRef.current && state?.modal !== 'setup') {
        setSetupModalOpen(false);
        if (!state || state.screen === screenRef.current) {
          return;
        }
      }

      if (!state) {
        if (screenRef.current !== 'home') {
          setSavedSession(loadLocalSession());
          setScreen('home');
        }
        return;
      }

      if (state.modal === 'setup') {
        setSetupModalOpen(true);
      }

      if (state.screen === 'host-room' || state.screen === 'player-room') {
        if (state.roomCode) {
          setActiveRoomCode(state.roomCode);
          setScreen(state.screen);
        } else {
          setSavedSession(loadLocalSession());
          setScreen('home');
          window.history.replaceState({ screen: 'home' } satisfies AppHistoryState, '', window.location.pathname || '/');
        }
        return;
      }

      if (screenRef.current === 'host-room' || screenRef.current === 'player-room') {
        setSavedSession(loadLocalSession());
      }

      if (state.inviteRoomCode !== undefined) {
        setInviteRoomCode(state.inviteRoomCode);
      }
      setScreen(state.screen || 'home');
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Global Online / Offline connectivity listeners with verified Firebase reconnect
  useEffect(() => {
    const handleOffline = () => {
      wasOfflineRef.current = true;
      setIsOffline(true);
      setConnectionVerifiedNotice(false);
      if (verifiedTimerRef.current) {
        window.clearTimeout(verifiedTimerRef.current);
        verifiedTimerRef.current = null;
      }
    };

    const handleOnline = () => {
      setIsOffline(false);
      if (wasOfflineRef.current || !auth?.currentUser || bootError) {
        wasOfflineRef.current = false;
        initializeBackend({ isReconnect: true });
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (verifiedTimerRef.current) {
        window.clearTimeout(verifiedTimerRef.current);
        verifiedTimerRef.current = null;
      }
    };
  }, [bootError, initializeBackend]);

  const ensureReadyUser = async (): Promise<string> => {
    if (uid && auth?.currentUser && auth.currentUser.uid === uid) {
      return uid;
    }
    const res = await ensureAnonymousAuth();
    if (res.needsAnonymousAuthSetup) {
      setNeedsAnonymousAuthSetup(true);
      openSetupModal();
      throw new Error(
        'Please enable Anonymous Authentication in Firebase Console (instructions opened).',
      );
    }
    if (!res.user) {
      throw new Error(res.error || 'Firebase authentication is not ready.');
    }
    setUid(res.user.uid);
    return res.user.uid;
  };

  const handleGoogleFallback = async () => {
    try {
      const user = await signInWithGoogleFallback();
      setUid(user.uid);
      setNeedsAnonymousAuthSetup(false);
      closeSetupModal();
      setBootError('');
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleCreateGame = async (hostName: string, gameName: string) => {
    const activeUid = await ensureReadyUser();
    setUid(activeUid);
    const { roomCode } = await createGameRoom(hostName, gameName);
    setSavedSession(loadLocalSession());
    navigateTo('host-room', { roomCode });
  };

  const handleJoinGame = async (playerName: string, roomCode: string) => {
    const activeUid = await ensureReadyUser();
    setUid(activeUid);
    const { roomCode: joinedCode, role } = await joinGameRoom(playerName, roomCode);
    setSavedSession(loadLocalSession());
    navigateTo(role === 'host' ? 'host-room' : 'player-room', {
      roomCode: joinedCode,
      inviteCode: '',
    });
  };

  const handleResumeSession = async (session: SavedSession) => {
    try {
      await ensureReadyUser();
      navigateTo(session.role === 'host' ? 'host-room' : 'player-room', {
        roomCode: session.roomCode,
      });
    } catch {
      // Handled by ensureReadyUser opening setup modal
    }
  };

  const handleLeaveRoom = async () => {
    if (screen === 'player-room' && activeRoomCode) {
      await leaveLobbyAsPlayer(activeRoomCode);
    } else {
      if (screen === 'host-room' && activeRoomCode) {
        await cleanupExpiredOrEndedHostedRooms().catch(() => {});
      }
      saveLocalSession(null);
    }
    setActiveRoomCode('');
    setInviteRoomCode('');
    setSavedSession(null);
    navigateTo('home', { roomCode: '', inviteCode: '', replace: true });
  };

  const inActiveRoom = screen === 'host-room' || screen === 'player-room';

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#080B18] via-[#0B1024] to-[#120F29] text-slate-100">
      <Header
        currentScreen={screen}
        inActiveRoom={inActiveRoom}
        onNavigate={(target) => navigateTo(target)}
        onOpenSetupGuide={openSetupModal}
        onLeaveRoom={handleLeaveRoom}
      />

      {/* Centralized non-overlapping connectivity status bar (never covers tickets, player, or buttons) */}
      {(isOffline || reconnecting || connectionVerifiedNotice) && (
        <div className="mx-auto mt-3 max-w-5xl px-4 sm:px-6 w-full">
          {isOffline ? (
            <div
              role="status"
              className="rounded-2xl border border-amber-400/40 bg-amber-500/15 px-4 py-2.5 text-xs sm:text-sm text-amber-100 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <WifiOff className="h-4 w-4 text-amber-300 shrink-0" />
                <span>
                  Offline: No internet connection. Waiting to reconnect automatically...
                </span>
              </div>
              <button
                type="button"
                onClick={() => initializeBackend({ isReconnect: true })}
                disabled={reconnecting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60 shrink-0 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${reconnecting ? 'animate-spin' : ''}`} />
                <span>Retry</span>
              </button>
            </div>
          ) : reconnecting ? (
            <div
              role="status"
              className="rounded-2xl border border-indigo-400/40 bg-indigo-500/15 px-4 py-2.5 text-xs sm:text-sm text-indigo-100 flex items-center gap-2"
            >
              <Loader2 className="h-4 w-4 animate-spin text-indigo-300 shrink-0" />
              <span>Reconnecting and verifying Firebase connection...</span>
            </div>
          ) : (
            <div
              role="status"
              className="rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2.5 text-xs sm:text-sm text-emerald-100 flex items-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
              <span>Back online — Firebase connection verified.</span>
            </div>
          )}
        </div>
      )}

      {/* Configuration / Setup Banners */}
      {!isFirebaseConfigured && (
        <div className="mx-auto mt-6 max-w-3xl px-4 w-full">
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 p-5 space-y-2">
            <div className="flex items-center gap-2 text-rose-200 font-bold">
              <AlertTriangle className="h-5 w-5" />
              <span>Firebase Configuration Missing</span>
            </div>
            <p className="text-sm text-rose-100">
              Real-time multiplayer rooms require Firebase configuration in <code>firebase-applet-config.json</code>. Open the Setup Guide for configuration instructions.
            </p>
            <button
              type="button"
              onClick={openSetupModal}
              className="rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 cursor-pointer"
            >
              Open Setup Guide
            </button>
          </div>
        </div>
      )}

      {needsAnonymousAuthSetup && (
        <div className="mx-auto mt-6 max-w-4xl px-4 w-full">
          <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-200">
                Enable Anonymous Authentication in Firebase Console
              </p>
              <p className="text-xs text-slate-200">
                So players can join without creating an account, enable Anonymous Sign-In for project{' '}
                <code>{firebaseProjectId}</code>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/providers`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300"
              >
                <span>Open Firebase Auth</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => initializeBackend({ isReconnect: true })}
                className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {bootError && isFirebaseConfigured && !isOffline && (
        <div className="mx-auto mt-6 max-w-3xl px-4 w-full">
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200 flex items-center justify-between gap-3">
            <span>{bootError}</span>
            <button
              type="button"
              onClick={() => initializeBackend({ isReconnect: true })}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shrink-0 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="flex-1">
        {booting ? (
          <div className="mx-auto max-w-3xl px-4 py-24 flex items-center justify-center gap-3 text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
            <span>Connecting to Dhiren Pathak Present Musical Housie...</span>
          </div>
        ) : (
          <Suspense fallback={<ScreenSuspenseFallback />}>
            {screen === 'home' && (
              <HomeView
                savedSession={savedSession}
                onHostClick={() => navigateTo('host-create')}
                onJoinClick={() => navigateTo('join')}
                onHowToPlayClick={() => navigateTo('how-to-play')}
                onResumeSession={handleResumeSession}
              />
            )}

            {screen === 'host-create' && (
              <HostCreateView
                onBack={() => navigateTo('home')}
                onCreateGame={handleCreateGame}
              />
            )}

            {screen === 'join' && (
              <JoinRoomView
                initialRoomCode={inviteRoomCode}
                onBack={() => navigateTo('home', { inviteCode: '' })}
                onJoinGame={handleJoinGame}
              />
            )}

            {screen === 'how-to-play' && (
              <HowToPlayView
                onBack={() => navigateTo('home')}
                onHostClick={() => navigateTo('host-create')}
                onJoinClick={() => navigateTo('join')}
              />
            )}

            {screen === 'host-room' && activeRoomCode && uid && (
              <HostGameView
                roomCode={activeRoomCode}
                hostUid={uid}
                onExitRoom={handleLeaveRoom}
              />
            )}

            {screen === 'player-room' && activeRoomCode && uid && (
              <PlayerGameView
                roomCode={activeRoomCode}
                playerUid={uid}
                onExitRoom={handleLeaveRoom}
                suppressOfflineBanner
              />
            )}
          </Suspense>
        )}
      </div>

      {!inActiveRoom && (
        <footer className="border-t border-white/10 py-6 px-4 sm:px-6 text-xs text-slate-400">
          <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3">
            <span>Dhiren Pathak Present Musical Housie · Casual multiplayer music bingo</span>
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => navigateTo('how-to-play')}
                className="hover:text-white transition-colors cursor-pointer"
              >
                How to Play
              </button>
              <button
                type="button"
                onClick={openSetupModal}
                className="hover:text-white transition-colors cursor-pointer"
              >
                Setup Guide
              </button>
            </div>
          </div>
        </footer>
      )}

      {setupModalOpen && (
        <Suspense fallback={null}>
          <SetupGuideModal
            open={setupModalOpen}
            onClose={closeSetupModal}
            needsAnonymousAuthSetup={needsAnonymousAuthSetup}
            onRetryAuth={() => initializeBackend({ isReconnect: true })}
            onGoogleFallback={handleGoogleFallback}
          />
        </Suspense>
      )}
    </div>
  );
}
