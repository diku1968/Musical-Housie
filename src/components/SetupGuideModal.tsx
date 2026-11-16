import { CheckCircle2, ExternalLink, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { firebaseProjectId, isFirebaseConfigured } from '../services/firebase.ts';
import { cleanupExpiredOrEndedHostedRooms } from '../services/gameService.ts';

interface SetupGuideModalProps {
  open: boolean;
  onClose: () => void;
  needsAnonymousAuthSetup: boolean;
  onRetryAuth?: () => void;
  onGoogleFallback?: () => void;
}

export function SetupGuideModal({
  open,
  onClose,
  needsAnonymousAuthSetup,
  onRetryAuth,
  onGoogleFallback,
}: SetupGuideModalProps) {
  const [cleaningDb, setCleaningDb] = useState(false);
  const [cleanupResult, setCleanupResult] = useState('');

  if (!open) return null;

  const handleCleanupDatabase = async () => {
    setCleaningDb(true);
    setCleanupResult('');
    try {
      const count = await cleanupExpiredOrEndedHostedRooms({ includeAllForHost: true });
      setCleanupResult(
        count > 0
          ? `Deleted ${count} old room(s) and their player/claim records from Firebase.`
          : 'No old hosted rooms found on this device — database is already clean.',
      );
    } catch (err) {
      setCleanupResult(err instanceof Error ? err.message : 'Could not clean up database.');
    } finally {
      setCleaningDb(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/15 bg-[#10162D] p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="setup-guide-title" className="font-display text-2xl font-extrabold text-white">
              Service Status &amp; Setup
            </h2>
            <p className="text-sm text-slate-300 mt-1">
              Hosts and players never need to enter API keys. All playlist credentials are managed securely by the server.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup guide"
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Firebase Status */}
        <section className="rounded-2xl border border-white/10 bg-[#0A0F20] p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-bold text-white">
              1. Multiplayer Sync (Firebase)
            </h3>
            <span
              className={`text-xs font-semibold ${
                isFirebaseConfigured && !needsAnonymousAuthSetup
                  ? 'text-emerald-300'
                  : 'text-amber-300'
              }`}
            >
              {isFirebaseConfigured && !needsAnonymousAuthSetup
                ? 'Ready'
                : 'Action Needed'}
            </span>
          </div>

          {!isFirebaseConfigured ? (
            <p className="text-sm text-rose-200">
              Firebase configuration is missing on this deployment. Add your Firebase web configuration to enable real-time game rooms.
            </p>
          ) : needsAnonymousAuthSetup ? (
            <div className="space-y-3 text-sm text-slate-300">
              <p className="text-amber-200 font-medium">
                Enable Anonymous sign-in in Firebase Console so players can join rooms without creating an account:
              </p>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                <li>
                  Open{' '}
                  <a
                    href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/providers`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-amber-300 underline hover:text-amber-200"
                  >
                    <span>Firebase Auth Sign-in Providers</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </li>
                <li>Select <strong>Anonymous</strong>, toggle <strong>Enable</strong>, and click <strong>Save</strong>.</li>
                <li>Click <strong>Retry Connection</strong> below.</li>
              </ol>
              <div className="flex flex-wrap gap-3 pt-1">
                {onRetryAuth && (
                  <button
                    type="button"
                    onClick={onRetryAuth}
                    className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300 cursor-pointer"
                  >
                    Retry Connection
                  </button>
                )}
                {onGoogleFallback && (
                  <button
                    type="button"
                    onClick={onGoogleFallback}
                    className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
                  >
                    Use Google Sign-In Instead
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Real-time multiplayer rooms and anonymous joining are active.</span>
              </p>
              <div className="rounded-xl border border-white/10 bg-[#121830] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-300">
                  Finished &amp; expired games are auto-deleted whenever you host a new game. You can also clear older hosted rooms manually anytime:
                </p>
                <button
                  type="button"
                  onClick={handleCleanupDatabase}
                  disabled={cleaningDb}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-400/15 px-3.5 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/25 disabled:opacity-50 shrink-0 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{cleaningDb ? 'Cleaning...' : 'Free Database Space'}</span>
                </button>
              </div>
              {cleanupResult && (
                <p className="text-xs text-emerald-300">{cleanupResult}</p>
              )}
            </div>
          )}
        </section>

        {/* YouTube Status */}
        <section className="rounded-2xl border border-white/10 bg-[#0A0F20] p-5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-bold text-white">
              2. YouTube Playlists
            </h3>
            <span className="text-xs font-semibold text-emerald-300">
              Ready (No API Key Needed)
            </span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">
            Public and unlisted YouTube playlists (including links copied from the mobile YouTube app) load automatically with zero API keys or developer accounts.
          </p>
        </section>
      </div>
    </div>
  );
}
