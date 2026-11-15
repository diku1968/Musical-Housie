import { ArrowLeft, Loader2, Users } from 'lucide-react';
import { FormEvent, useState } from 'react';

interface JoinRoomViewProps {
  initialRoomCode?: string;
  onBack: () => void;
  onJoinGame: (playerName: string, roomCode: string) => Promise<void>;
}

export function JoinRoomView({
  initialRoomCode = '',
  onBack,
  onJoinGame,
}: JoinRoomViewProps) {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState(
    initialRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = playerName.trim();
    const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (!cleanName) {
      setError('Please enter your Player Name.');
      return;
    }
    if (cleanCode.length !== 6) {
      setError('Please enter the 6-character Room Code.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await onJoinGame(cleanName, cleanCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join room.');
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
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
            Join a Game
          </h1>
          <p className="text-sm text-slate-300">
            Enter your name and the 6-character room code shared by your host.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="player-name" className="block text-sm font-semibold text-slate-200">
              Player Name <span className="text-amber-400">*</span>
            </label>
            <input
              id="player-name"
              type="text"
              required
              maxLength={40}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="e.g., Arjun"
              className="w-full rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="room-code" className="block text-sm font-semibold text-slate-200">
              6-Character Room Code <span className="text-amber-400">*</span>
            </label>
            <input
              id="room-code"
              type="text"
              required
              maxLength={6}
              value={roomCode}
              onChange={(e) =>
                setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
              }
              placeholder="ABC123"
              className="w-full rounded-xl border border-white/15 bg-[#090D1C] px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.25em] text-white placeholder:text-slate-600 focus:border-indigo-400 focus:outline-none uppercase"
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
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-6 py-4 text-base font-extrabold text-white hover:bg-indigo-400 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Joining Room...</span>
              </>
            ) : (
              <>
                <Users className="h-5 w-5" />
                <span>JOIN GAME</span>
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
