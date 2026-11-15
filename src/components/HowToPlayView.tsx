import { ArrowLeft } from 'lucide-react';
import { ALL_PATTERNS, PATTERN_DESCRIPTIONS, PATTERN_LABELS } from '../shared/types.ts';

interface HowToPlayViewProps {
  onBack: () => void;
  onHostClick: () => void;
  onJoinClick: () => void;
}

const STEPS = [
  {
    num: '01',
    title: 'Host creates a game',
    detail: 'Click Host a Game, type your name, and get a unique 6-character room code right away.',
  },
  {
    num: '02',
    title: 'Friends join with the room code',
    detail: 'Share the code or WhatsApp invite link. Players enter their name and join without registration.',
  },
  {
    num: '03',
    title: 'Host selects a playlist',
    detail: 'Paste a public YouTube or Spotify playlist URL with at least 15 accessible songs.',
  },
  {
    num: '04',
    title: 'Everyone receives a ticket',
    detail: 'When the host starts the game, each player automatically gets a unique 3x5 Musical Housie ticket with 15 songs.',
  },
  {
    num: '05',
    title: 'Host plays music',
    detail: 'The host plays songs one by one (in random mode or playlist order) while the song title stays hidden from players.',
  },
  {
    num: '06',
    title: 'Players identify and mark songs',
    detail: 'Listen carefully to the song playing. If you recognize it on your ticket, tap the cell to mark it.',
  },
  {
    num: '07',
    title: 'Players claim winning patterns',
    detail: 'Once you complete an enabled pattern (such as First Five, Top Row, or Full House), tap Claim Win.',
  },
  {
    num: '08',
    title: 'Host verifies winners',
    detail: 'Your claim is checked against officially played songs on the server. Once approved, the winner is announced to everyone.',
  },
];

export function HowToPlayView({ onBack, onHostClick, onJoinClick }: HowToPlayViewProps) {
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-10 space-y-10">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Home</span>
      </button>

      <div className="space-y-3">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white">
          How to Play Musical Housie
        </h1>
        <p className="text-base text-slate-300 max-w-2xl">
          Everything you need to host a round in under a minute and play together on phones, tablets, or laptops.
        </p>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {STEPS.map((step) => (
          <div
            key={step.num}
            className="rounded-2xl border border-white/10 bg-[#121830] p-5 space-y-2"
          >
            <span className="text-xs font-mono font-bold text-amber-300">{step.num}</span>
            <h2 className="font-display text-lg font-bold text-white">{step.title}</h2>
            <p className="text-sm text-slate-300 leading-relaxed">{step.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 space-y-5">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-white">
            Winning Patterns
          </h2>
          <p className="text-sm text-slate-300 mt-1">
            Hosts can enable or disable any of these 5 patterns in the lobby before starting.
          </p>
        </div>

        <div className="divide-y divide-white/10">
          {ALL_PATTERNS.map((pattern) => (
            <div
              key={pattern}
              className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
            >
              <span className="font-semibold text-white">{PATTERN_LABELS[pattern]}</span>
              <span className="text-sm text-slate-300">{PATTERN_DESCRIPTIONS[pattern]}</span>
            </div>
          ))}
        </div>

        <div className="pt-4 flex flex-wrap gap-3">
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
