import { onAuthStateChanged, type User } from 'firebase/auth';
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
import { VisitorCounter } from './components/VisitorCounter.tsx';
import {
  recordVisitorSession,
  startPresenceHeartbeat,
} from './services/analyticsService.ts';
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
const AboutView = lazy(() =>
  import('./components/AboutView.tsx').then((m) => ({ default: m.AboutView })),
);
const ContactView = lazy(() =>
  import('./components/ContactView.tsx').then((m) => ({ default: m.ContactView })),
);
const PrivacyPolicyView = lazy(() =>
  import('./components/PrivacyPolicyView.tsx').then((m) => ({ default: m.PrivacyPolicyView })),
);
const TermsView = lazy(() =>
  import('./components/TermsView.tsx').then((m) => ({ default: m.TermsView })),
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
const DeveloperAnalyticsView = lazy(() =>
  import('./components/DeveloperAnalyticsView.tsx').then((m) => ({
    default: m.DeveloperAnalyticsView,
  })),
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
  'about',
  'contact',
  'privacy-policy',
  'terms',
  'host-create',
  'join',
  'dev-analytics',
]);

const PATH_TO_SCREEN: Record<string, AppScreen> = {
  '/': 'home',
  '/how-to-play': 'how-to-play',
  '/about': 'about',
  '/contact': 'contact',
  '/privacy-policy': 'privacy-policy',
  '/terms': 'terms',
  '/host-create': 'host-create',
  '/join': 'join',
  '/dev-analytics': 'dev-analytics',
};

const SCREEN_TO_PATH: Record<AppScreen, string> = {
  home: '/',
  'how-to-play': '/how-to-play',
  about: '/about',
  contact: '/contact',
  'privacy-policy': '/privacy-policy',
  terms: '/terms',
  'host-create': '/host-create',
  join: '/join',
  'host-room': '/host-room',
  'player-room': '/player-room',
  'dev-analytics': '/dev-analytics',
};

const PAGE_METADATA: Record<AppScreen, { title: string; description: string; canonicalPath: string }> = {
  home: {
    title: 'Dhiren Pathak Present Musical Housie — Real-Time Multiplayer Music Bingo',
    description:
      'Host and play real-time multiplayer Musical Housie with friends and family using YouTube playlists, unique 3x5 tickets, and live pattern verification.',
    canonicalPath: '/',
  },
  'how-to-play': {
    title: 'How to Play — Dhiren Pathak Present Musical Housie',
    description:
      'Step-by-step guide to hosting a room, loading YouTube playlists, marking 3x5 Musical Housie tickets, and verifying winning patterns.',
    canonicalPath: '/how-to-play',
  },
  about: {
    title: 'About Us — Dhiren Pathak Present Musical Housie',
    description:
      'Learn about Dhiren Pathak Present Musical Housie, a free multiplayer music bingo web experience powered by YouTube playlists.',
    canonicalPath: '/about',
  },
  contact: {
    title: 'Contact Us — Dhiren Pathak Present Musical Housie',
    description:
      'Contact the Dhiren Pathak Present Musical Housie team for gameplay support, technical questions, privacy inquiries, or feedback.',
    canonicalPath: '/contact',
  },
  'privacy-policy': {
    title: 'Privacy Policy — Dhiren Pathak Present Musical Housie',
    description:
      'Privacy Policy detailing session storage, Firebase anonymous authentication, YouTube embedded playback, and Google AdSense cookies on Musical Housie.',
    canonicalPath: '/privacy-policy',
  },
  terms: {
    title: 'Terms and Conditions — Dhiren Pathak Present Musical Housie',
    description:
      'Terms and Conditions governing fair play, casual entertainment use, and YouTube playlist playback on Dhiren Pathak Present Musical Housie.',
    canonicalPath: '/terms',
  },
  'host-create': {
    title: 'Host a Game — Dhiren Pathak Present Musical Housie',
    description: 'Create a 6-character Musical Housie room and invite friends and family to play.',
    canonicalPath: '/host-create',
  },
  join: {
    title: 'Join a Game — Dhiren Pathak Present Musical Housie',
    description: 'Enter a 6-character room code to join a live Musical Housie multiplayer room.',
    canonicalPath: '/join',
  },
  'host-room': {
    title: 'Host Dashboard — Dhiren Pathak Present Musical Housie',
    description: 'Live host room for managing Musical Housie playlists, songs, and winner verification.',
    canonicalPath: '/host-room',
  },
  'player-room': {
    title: 'Live Ticket Room — Dhiren Pathak Present Musical Housie',
    description: 'Live player ticket and song matching view for Musical Housie.',
    canonicalPath: '/player-room',
  },
  'dev-analytics': {
    title: 'Developer Analytics — Musical Housie',
    description: 'Restricted developer analytics dashboard.',
    canonicalPath: '/dev-analytics',
  },
};
