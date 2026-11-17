import { ArrowLeft } from 'lucide-react';
import { GlobalBranding } from './GlobalBranding.tsx';

interface TermsViewProps {
  onBack: () => void;
}

export function TermsView({ onBack }: TermsViewProps) {
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

      <header className="space-y-2">
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white">
          Terms and Conditions
        </h1>
        <p className="text-sm text-slate-400">
          Last updated: November 2026 · Dhiren Pathak Present Musical Housie
        </p>
      </header>

      <div className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 space-y-6 text-sm text-slate-300 leading-relaxed">
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">1. Acceptance of Terms</h2>
          <p>
            By accessing or playing on Dhiren Pathak Present Musical Housie (<code>https://musical-housie.ai.studio/</code>), you agree to use this website solely for lawful, casual social entertainment in accordance with these Terms and Conditions.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">2. Casual Entertainment &amp; No Real-Money Gambling</h2>
          <p>
            Musical Housie is provided free of charge for casual music bingo games among friends, families, and groups. This platform does not process payments, wagers, or real-money prizes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">3. YouTube Playlists &amp; Content</h2>
          <p>
            Hosts are responsible for selecting public or unlisted YouTube playlists that comply with YouTube&apos;s Terms of Service and copyright guidelines. Musical Housie does not host or redistribute audio/video files; all media playback streams through the official embedded YouTube player.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">4. Fair Play &amp; Acceptable Use</h2>
          <p>
            Users must not attempt to bypass server-side claim verification, disrupt active game rooms, scrape private room data, or abuse automated traffic against backend endpoints.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">5. Service Availability</h2>
          <p>
            The service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. While we work to keep multiplayer rooms responsive and accurate, temporary interruptions may occur due to network conditions, third-party media availability, or maintenance.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">6. Contact</h2>
          <p>
            Questions about these Terms and Conditions may be sent to{' '}
            <a
              href="mailto:dhirenpathak1970@gmail.com"
              className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
            >
              dhirenpathak1970@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
