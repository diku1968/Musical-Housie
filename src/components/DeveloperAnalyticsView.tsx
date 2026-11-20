import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Activity,
  ArrowLeft,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Eye,
  Gamepad2,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  AnalyticsAccessError,
  type DeveloperAnalyticsPayload,
  fetchDeveloperAnalytics,
} from '../services/analyticsService.ts';
import {
  auth,
  signInWithGoogleFallback,
  signOutCurrentUser,
} from '../services/firebase.ts';

interface DeveloperAnalyticsViewProps {
  onBack: () => void;
}

const AUTO_REFRESH_MS = 30_000;

export function DeveloperAnalyticsView({ onBack }: DeveloperAnalyticsViewProps) {
  const [user, setUser] = useState<User | null>(() => auth?.currentUser ?? null);
  const [authReady, setAuthReady] = useState(Boolean(auth?.currentUser));
  const [signingIn, setSigningIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<DeveloperAnalyticsPayload | null>(null);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const isSignedInWithAccount = Boolean(user && !user.isAnonymous && user.email);

  const loadAnalytics = useCallback(async (opts?: { silent?: boolean }) => {
    if (!auth?.currentUser || auth.currentUser.isAnonymous) {
      setPayload(null);
      setAccessDeniedMessage('');
      setErrorMessage('');
      return;
    }
    if (!opts?.silent) {
      setLoading(true);
    }
    setErrorMessage('');
    try {
      const data = await fetchDeveloperAnalytics();
      setPayload(data);
      setAccessDeniedMessage('');
    } catch (err) {
      if (err instanceof AnalyticsAccessError && (err.status === 401 || err.status === 403)) {
        setPayload(null);
        setAccessDeniedMessage(err.message);
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : 'Unable to load developer analytics.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!isSignedInWithAccount) {
      setPayload(null);
      setAccessDeniedMessage('');
      setErrorMessage('');
      return;
    }
    loadAnalytics();
    const timer = window.setInterval(() => {
      loadAnalytics({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [authReady, isSignedInWithAccount, loadAnalytics]);

  const handleDeveloperSignIn = async () => {
    setSigningIn(true);
    setErrorMessage('');
    setAccessDeniedMessage('');
    try {
      await signInWithGoogleFallback();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.',
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setPayload(null);
    setAccessDeniedMessage('');
    setErrorMessage('');
    try {
      await signOutCurrentUser();
    } catch {
      // Ignore sign-out errors
    }
  };

  const metrics = payload?.metrics;

  const statCards = metrics
    ? [
        {
          label: 'Total Unique Visitors',
          value: metrics.totalUniqueVisitors,
          subtitle: 'All-time deduplicated visitors',
          icon: Eye,
          accent: 'text-amber-300 border-amber-400/25 bg-amber-400/10',
        },
        {
          label: 'Total Registered Users',
          value: metrics.totalRegisteredUsers,
          subtitle: 'Authenticated accounts tracked',
          icon: UserCheck,
          accent: 'text-emerald-300 border-emerald-400/25 bg-emerald-400/10',
        },
        {
          label: 'Total App Opens',
          value: metrics.totalAppOpens,
          subtitle: 'Cumulative app sessions',
          icon: TrendingUp,
          accent: 'text-sky-300 border-sky-400/25 bg-sky-400/10',
        },
        {
          label: "Today's Visitors",
          value: metrics.todaysVisitors,
          subtitle: `UTC Date: ${payload.dateKey} (${metrics.todaysAppOpens.toLocaleString()} opens)`,
          icon: Calendar,
          accent: 'text-indigo-300 border-indigo-400/25 bg-indigo-400/10',
        },
        {
          label: 'Monthly Visitors',
          value: metrics.monthlyVisitors,
          subtitle: `UTC Month: ${payload.monthKey} (${metrics.monthlyAppOpens.toLocaleString()} opens)`,
          icon: CalendarDays,
          accent: 'text-violet-300 border-violet-400/25 bg-violet-400/10',
        },
        {
          label: 'Currently Online Users',
          value: metrics.currentlyOnlineUsers,
          subtitle: 'Active within the last 2 minutes',
          icon: Activity,
          accent: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/15',
        },
        {
          label: 'Total Games Played',
          value: metrics.totalGamesPlayed,
          subtitle: 'Live Musical Housie games started',
          icon: Gamepad2,
          accent: 'text-amber-300 border-amber-400/25 bg-amber-400/10',
        },
        {
          label: 'Total Completed Games',
          value: metrics.totalCompletedGames,
          subtitle: 'Sessions finished by host',
          icon: CheckCircle2,
          accent: 'text-teal-300 border-teal-400/25 bg-teal-400/10',
        },
        {
          label: 'Total Players Participated',
          value: metrics.totalPlayersParticipated,
          subtitle: 'Players dealt official 3×5 tickets',
          icon: Users,
          accent: 'text-rose-300 border-rose-400/25 bg-rose-400/10',
        },
      ]
    : [];

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Home</span>
        </button>

        {isSignedInWithAccount && (
          <div className="flex flex-wrap items-center gap-2.5">
            {payload && (
              <button
                type="button"
                onClick={() => loadAnalytics()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-xs sm:text-sm font-semibold text-amber-200 hover:bg-amber-400/20 disabled:opacity-60 transition-colors cursor-pointer"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>

      {/* Private Sign-In Gate for unauthenticated or anonymous visitors */}
      {!authReady ? (
        <section className="rounded-3xl border border-white/10 bg-[#10162D]/90 p-10 flex items-center justify-center gap-3 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
          <span>Checking developer authorization...</span>
        </section>
      ) : !isSignedInWithAccount ? (
        <section className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-[#10162D]/95 p-8 text-center space-y-5 shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Lock className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-white">
              Developer Analytics Dashboard
            </h1>
            <p className="text-sm text-slate-300">
              This private dashboard is restricted to the authorized Musical Housie developer account. Sign in with your verified administrator account to continue.
            </p>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-rose-400/35 bg-rose-500/15 px-4 py-3 text-xs sm:text-sm text-rose-200">
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            onClick={handleDeveloperSignIn}
            disabled={signingIn}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {signingIn ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            <span>{signingIn ? 'Signing in...' : 'Sign in with Developer Google Account'}</span>
          </button>
        </section>
      ) : accessDeniedMessage ? (
        <section className="mx-auto max-w-lg rounded-3xl border border-rose-400/35 bg-[#191224]/95 p-8 text-center space-y-5 shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/40 bg-rose-500/15 text-rose-300">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-white">Access Denied</h1>
            <p className="text-sm text-rose-200">{accessDeniedMessage}</p>
            <p className="text-xs text-slate-400">
              Private analytics are never accessible to standard player or visitor accounts.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>Switch Account</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors cursor-pointer"
            >
              <span>Return Home</span>
            </button>
          </div>
        </section>
      ) : loading && !payload ? (
        <section className="rounded-3xl border border-white/10 bg-[#10162D]/90 p-12 flex items-center justify-center gap-3 text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
          <span>Verifying developer permissions and loading analytics...</span>
        </section>
      ) : payload ? (
        <div className="space-y-6">
          <section className="rounded-3xl border border-emerald-400/25 bg-gradient-to-br from-[#101834] to-[#0D1329] p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                <ShieldCheck className="h-4 w-4" />
                <span>Private Developer Analytics</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
                Musical Housie Overview
              </h1>
              <p className="text-xs sm:text-sm text-slate-300">
                Aggregated real-time visitor and gameplay metrics. No personal user data is exposed.
              </p>
            </div>
            <div className="text-left sm:text-right text-xs text-slate-400 space-y-1 shrink-0">
              <div>
                UTC Window:{' '}
                <span className="font-mono text-slate-200">{payload.dateKey}</span>
              </div>
              <div>
                Last updated:{' '}
                <span className="font-mono text-slate-200">
                  {new Date(payload.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
          </section>

          {errorMessage && (
            <div className="rounded-2xl border border-amber-400/35 bg-amber-500/15 px-4 py-3 text-xs sm:text-sm text-amber-100">
              {errorMessage}
            </div>
          )}

          <section
            aria-label="Developer analytics metrics"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <article
                  key={card.label}
                  className="rounded-2xl border border-white/10 bg-[#10162E]/90 p-5 flex flex-col justify-between gap-4 shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-semibold text-slate-200">{card.label}</h2>
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${card.accent}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="font-mono text-3xl sm:text-4xl font-extrabold tabular-nums text-white tracking-tight">
                      {card.value.toLocaleString('en-US')}
                    </p>
                    <p className="text-xs text-slate-400">{card.subtitle}</p>
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      ) : (
        <section className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-8 text-center space-y-4">
          <p className="text-sm text-rose-200">
            {errorMessage || 'Unable to load analytics metrics right now.'}
          </p>
          <button
            type="button"
            onClick={() => loadAnalytics()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Retry</span>
          </button>
        </section>
      )}
    </main>
  );
}
