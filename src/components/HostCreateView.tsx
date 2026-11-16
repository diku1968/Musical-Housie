import { ArrowLeft, Loader2, Play } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { GlobalBranding } from './GlobalBranding.tsx';

interface HostCreateViewProps {
  onBack: () => void;
  onCreateGame: (hostName: string, gameName: string) => Promise<void>;
}

export function HostCreateView({ onBack, onCreateGame }: HostCreateViewProps) {
  const [hostName, setHostName] = useState('');
  const [gameName, setGameName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanHost = hostName.trim();
    if (!cleanHost) {
      setError('Please enter your Host Name.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onCreateGame(cleanHost, gameName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create game room.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-xl px-4 sm:px-6 py-10 sm:py-16">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors mb-6 cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Home</span>
      </button>

      <div className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 shadow-xl space-y-6">
        <GlobalBranding variant="bar" />
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
            Host a Game
          </h1>
          <p className="text-sm text-slate-300">
            Enter your name to generate a unique 6-character room code. You will choose your playlist inside the lobby.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="host-name" className="block text-sm font-semibold text-slate-200">
              Host Name <span className="text-amber-400">*</span>
            </label>
            <input
              id="host-name"
              type="text"
              required
              maxLength={40}
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              placeholder="e.g., Priya"
              className="w-full rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="game-name" className="block text-sm font-semibold text-slate-200">
              Game Name <span className="text-xs font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="game-name"
              type="text"
              maxLength={60}
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="e.g., Friday 90s Hits"
              className="w-full rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-6 py-4 text-base font-extrabold text-slate-950 hover:bg-amber-300 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Creating Room...</span>
              </>
            ) : (
              <>
                <Play className="h-5 w-5 fill-slate-950" />
                <span>CREATE GAME</span>
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
