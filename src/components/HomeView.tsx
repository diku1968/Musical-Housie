import { Disc3, HelpCircle, Play, Users } from 'lucide-react';
import { useState } from 'react';
import { SavedSession } from '../services/gameService.ts';

interface HomeViewProps {
  savedSession: SavedSession | null;
  onHostClick: () => void;
  onJoinClick: () => void;
  onHowToPlayClick: () => void;
  onResumeSession: (session: SavedSession) => void;
}

export function HomeView({
  savedSession,
  onHostClick,
  onJoinClick,
  onHowToPlayClick,
  onResumeSession,
}: HomeViewProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-14 space-y-12">
      {savedSession && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 sm:px-6">
          <div>
            <p className="text-sm font-semibold text-amber-200">
              Active {savedSession.role === 'host' ? 'Host' : 'Player'} Session Found
            </p>
            <p className="text-xs text-slate-300 mt-0.5">
              Room <span className="font-mono font-bold text-white">{savedSession.roomCode}</span> · Signed in as {savedSession.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onResumeSession(savedSession)}
            className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Rejoin Room {savedSession.roomCode}
          </button>
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.12] text-balance">
                <span className="block text-amber-300 text-lg sm:text-2xl font-bold mb-1">
                  Dhiren Pathak Present
                </span>
                Musical Housie
              </h1>
              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-xl">
                Pick a YouTube playlist, share a 6-character code, and play live music bingo with friends &amp; family. No accounts or downloads required.
              </p>
            </div>

            {/* Corner Portrait on Home Page (mobile & desktop top-right corner of hero) */}
            <div className="shrink-0 flex flex-col items-center gap-1.5 rounded-2xl border border-amber-400/40 bg-[#10162E] p-2 shadow-xl lg:hidden">
              <img
                src="/assets/aistudio/Screenshot_2025-10-17_100636_78a1ec3b.png"
                alt="Dhiren Pathak"
                className="h-20 w-20 sm:h-24 sm:w-24 rounded-xl object-cover object-top"
              />
              <span className="text-[11px] font-bold text-amber-300">Dhiren Pathak</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <button
              type="button"
              onClick={onHostClick}
              className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-amber-400 p-6 text-left text-slate-950 shadow-lg shadow-amber-950/30 hover:bg-amber-300 active:scale-[0.99] transition-all cursor-pointer min-h-[140px]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950/15">
                <Play className="h-5 w-5 fill-slate-950" />
              </div>
              <div>
                <div className="font-display text-xl font-extrabold tracking-tight">
                  HOST A GAME
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900/80">
                  Create a room and play music
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={onJoinClick}
              className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-indigo-400/35 bg-[#141C38] p-6 text-left text-white hover:border-indigo-400/70 hover:bg-[#192347] active:scale-[0.99] transition-all cursor-pointer min-h-[140px]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-xl font-extrabold tracking-tight">
                  JOIN A GAME
                </div>
                <p className="mt-1 text-sm text-slate-300">
                  Enter a 6-character room code
                </p>
              </div>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-2 text-sm text-slate-300">
            <button
              type="button"
              onClick={onHowToPlayClick}
              className="inline-flex items-center gap-2 font-semibold text-indigo-300 hover:text-indigo-200 transition-colors cursor-pointer"
            >
              <HelpCircle className="h-4 w-4" />
              <span>How to Play</span>
            </button>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="text-slate-400">
              15-song unique tickets · Live pattern verification
            </span>
          </div>
        </div>

        <div className="lg:col-span-5 flex justify-center">
          <div className="relative w-full max-w-[340px] aspect-square overflow-hidden rounded-3xl border border-white/10 bg-[#10162E] shadow-2xl">
            {!imgError ? (
              <img
                src="/src/assets/images/musical_housie_emblem_1794644150799.jpg"
                alt="Dhiren Pathak Present Musical Housie emblem"
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-indigo-950 via-[#0E1328] to-violet-950 p-8 text-center">
                <Disc3 className="h-16 w-16 text-amber-400" />
                <span className="font-display text-xl font-bold text-white">
                  Dhiren Pathak Present Musical Housie
                </span>
              </div>
            )}

            {/* Top-right corner presenter portrait on desktop */}
            <div className="hidden lg:flex flex-col items-center gap-1 absolute top-3 right-3 rounded-2xl border border-amber-400/70 bg-[#080B18]/90 backdrop-blur-sm p-1.5 shadow-2xl">
              <img
                src="/assets/aistudio/Screenshot_2025-10-17_100636_78a1ec3b.png"
                alt="Dhiren Pathak"
                className="h-24 w-24 rounded-xl object-cover object-top"
              />
              <span className="text-[11px] font-bold text-amber-300 px-1">Dhiren Pathak</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 pt-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-white/10 bg-[#11172E] p-5 space-y-2">
            <p className="text-xs font-semibold text-amber-300">01. Create &amp; Share</p>
            <h2 className="font-display text-lg font-bold text-white">Instant 6-Character Room</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Hosts launch a room in seconds and share a link or WhatsApp invite. Friends join without signing up.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#11172E] p-5 space-y-2">
            <p className="text-xs font-semibold text-indigo-300">02. Listen &amp; Mark</p>
            <h2 className="font-display text-lg font-bold text-white">Secret Song Guessing</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              The host plays tracks from YouTube while song titles stay hidden until you identify and tap them on your 3x5 ticket.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#11172E] p-5 space-y-2">
            <p className="text-xs font-semibold text-emerald-300">03. Claim &amp; Verify</p>
            <h2 className="font-display text-lg font-bold text-white">Fair Winner Checks</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Tap Claim Win for First Five, Rows, or Full House. Every claim is verified server-side against officially played songs.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
