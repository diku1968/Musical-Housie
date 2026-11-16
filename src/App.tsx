import { onAuthStateChanged } from 'firebase/auth';
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { AppScreen, Header } from './components/Header.tsx';
import { HomeView } from './components/HomeView.tsx';
import { HostCreateView } from './components/HostCreateView.tsx';
import { HostGameView } from './components/HostGameView.tsx';
import { HowToPlayView } from './components/HowToPlayView.tsx';
import { JoinRoomView } from './components/JoinRoomView.tsx';
import { PlayerGameView } from './components/PlayerGameView.tsx';
import { SetupGuideModal } from './components/SetupGuideModal.tsx';
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

  const initializeBackend = useCallback(async () => {
    setBooting(true);
    setBootError('');

    if (!isFirebaseConfigured) {
      setBootError('Firebase configuration is missing.');
      setBooting(false);
      return;
    }

    const conn = await testFirestoreConnection();
    if (!conn.ok) {
      setBootError(conn.error || 'Could not connect to Firestore.');
      setBooting(false);
      return;
    }

    const authResult = await ensureAnonymousAuth();
    if (authResult.needsAnonymousAuthSetup) {
      setNeedsAnonymousAuthSetup(true);
      setBooting(false);
      return;
    }
    if (!authResult.user) {
      setBootError(authResult.error || 'Unable to initialize Firebase session.');
      setBooting(false);
      return;
    }

    setNeedsAnonymousAuthSetup(false);
    setUid(authResult.user.uid);
    setBooting(false);

    // Clean up any ended, expired, or empty rooms previously hosted from this browser
    cleanupExpiredOrEndedHostedRooms().catch(() => {});
  }, []);

  useEffect(() => {
    initializeBackend();

    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room')?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (roomParam && /^[A-Z0-9]{6}$/.test(roomParam)) {
      setInviteRoomCode(roomParam);
      setScreen('join');
    } else {
      setSavedSession(loadLocalSession());
    }

    if (!auth) return;
    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUid(currentUser?.uid || '');
    });
    return () => unsubAuth();
  }, [initializeBackend]);

  const ensureReadyUser = async (): Promise<string> => {
    if (uid && auth?.currentUser && auth.currentUser.uid === uid) {
      return uid;
    }
    const res = await ensureAnonymousAuth();
    if (res.needsAnonymousAuthSetup) {
      setNeedsAnonymousAuthSetup(true);
      setSetupModalOpen(true);
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
      setSetupModalOpen(false);
      setBootError('');
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleCreateGame = async (hostName: string, gameName: string) => {
    const activeUid = await ensureReadyUser();
    setUid(activeUid);
    const { roomCode } = await createGameRoom(hostName, gameName);
    setActiveRoomCode(roomCode);
    setSavedSession(loadLocalSession());
    setScreen('host-room');
  };

  const handleJoinGame = async (playerName: string, roomCode: string) => {
    const activeUid = await ensureReadyUser();
    setUid(activeUid);
    const { roomCode: joinedCode, role } = await joinGameRoom(playerName, roomCode);
    setActiveRoomCode(joinedCode);
    setSavedSession(loadLocalSession());
    setScreen(role === 'host' ? 'host-room' : 'player-room');
  };

  const handleResumeSession = async (session: SavedSession) => {
    try {
      await ensureReadyUser();
      setActiveRoomCode(session.roomCode);
      setScreen(session.role === 'host' ? 'host-room' : 'player-room');
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
    setSavedSession(null);
    if (window.location.search.includes('room=')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setScreen('home');
  };

  const inActiveRoom = screen === 'host-room' || screen === 'player-room';

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#080B18] via-[#0B1024] to-[#120F29] text-slate-100">
      <Header
        currentScreen={screen}
        inActiveRoom={inActiveRoom}
        onNavigate={(target) => {
          if (target === 'home' && inActiveRoom) {
            setSavedSession(loadLocalSession());
          }
          setScreen(target);
        }}
        onOpenSetupGuide={() => setSetupModalOpen(true)}
        onLeaveRoom={handleLeaveRoom}
      />

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
              onClick={() => setSetupModalOpen(true)}
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
                onClick={initializeBackend}
                className="rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {bootError && isFirebaseConfigured && (
        <div className="mx-auto mt-6 max-w-3xl px-4 w-full">
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200 flex items-center justify-between gap-3">
            <span>{bootError}</span>
            <button
              type="button"
              onClick={initializeBackend}
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
          <>
            {screen === 'home' && (
              <HomeView
                savedSession={savedSession}
                onHostClick={() => setScreen('host-create')}
                onJoinClick={() => setScreen('join')}
                onHowToPlayClick={() => setScreen('how-to-play')}
                onResumeSession={handleResumeSession}
              />
            )}

            {screen === 'host-create' && (
              <HostCreateView
                onBack={() => setScreen('home')}
                onCreateGame={handleCreateGame}
              />
            )}

            {screen === 'join' && (
              <JoinRoomView
                initialRoomCode={inviteRoomCode}
                onBack={() => setScreen('home')}
                onJoinGame={handleJoinGame}
              />
            )}

            {screen === 'how-to-play' && (
              <HowToPlayView
                onBack={() => setScreen('home')}
                onHostClick={() => setScreen('host-create')}
                onJoinClick={() => setScreen('join')}
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
              />
            )}
          </>
        )}
      </div>

      {!inActiveRoom && (
        <footer className="border-t border-white/10 py-6 px-4 sm:px-6 text-xs text-slate-400">
          <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3">
            <span>Dhiren Pathak Present Musical Housie · Casual multiplayer music bingo</span>
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => setScreen('how-to-play')}
                className="hover:text-white transition-colors cursor-pointer"
              >
                How to Play
              </button>
              <button
                type="button"
                onClick={() => setSetupModalOpen(true)}
                className="hover:text-white transition-colors cursor-pointer"
              >
                Setup Guide
              </button>
            </div>
          </div>
        </footer>
      )}

      <SetupGuideModal
        open={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        needsAnonymousAuthSetup={needsAnonymousAuthSetup}
        onRetryAuth={initializeBackend}
        onGoogleFallback={handleGoogleFallback}
      />
    </div>
  );
}
