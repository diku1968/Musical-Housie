import { ArrowLeft, Music2, ShieldCheck, Users } from 'lucide-react';
import { GlobalBranding } from './GlobalBranding.tsx';

interface AboutViewProps {
  onBack: () => void;
  onHostClick: () => void;
  onJoinClick: () => void;
}

export function AboutView({ onBack, onHostClick, onJoinClick }: AboutViewProps) {
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 space-y-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Home</span>
      </button>

      <GlobalBranding variant="bar" />

      <header className="space-y-3">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white">
          About Dhiren Pathak Present Musical Housie
        </h1>
        <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
          Musical Housie is a free, browser-based multiplayer music bingo platform built to bring families, friends, and party groups together around shared playlists without sign-ups or app downloads.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-white/10 bg-[#121830] p-5 space-y-2.5">
          <Music2 className="h-6 w-6 text-amber-400" />
          <h2 className="font-display text-lg font-bold text-white">Playlist-Driven Gameplay</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Hosts load any public or unlisted YouTube playlist with at least 15 playable tracks and play songs live via the embedded YouTube player.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121830] p-5 space-y-2.5">
          <Users className="h-6 w-6 text-indigo-400" />
          <h2 className="font-display text-lg font-bold text-white">Instant Multiplayer Rooms</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Every game uses a unique 6-character room code and shareable QR or invite link. Each player receives a unique 3×5 Musical Housie ticket.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#121830] p-5 space-y-2.5">
          <ShieldCheck className="h-6 w-6 text-emerald-400" />
          <h2 className="font-display text-lg font-bold text-white">Server-Verified Fairness</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Claims for First Five, Top Row, Middle Row, Bottom Row, and Full House are verified against the officially played song log on the server.
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 space-y-4">
        <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
          Created &amp; Presented by Dhiren Pathak
        </h2>
        <p className="text-sm text-slate-300 leading-relaxed">
          Whether it is a family gathering, festival evening, birthday celebration, or virtual meetup, Dhiren Pathak Present Musical Housie replaces paper slips and manual song tracking with fast real-time synchronization across phones, tablets, and desktops.
        </p>
        <div className="pt-2 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onHostClick}
            className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors cursor-pointer"
          >
            Host a Game
          </button>
          <button
            type="button"
            onClick={onJoinClick}
            className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            Join a Game
          </button>
        </div>
      </section>
    </main>
  );
}
