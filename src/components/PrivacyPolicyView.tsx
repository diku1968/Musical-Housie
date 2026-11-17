import { ArrowLeft } from 'lucide-react';
import { GlobalBranding } from './GlobalBranding.tsx';

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

export function PrivacyPolicyView({ onBack }: PrivacyPolicyViewProps) {
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
          Privacy Policy
        </h1>
        <p className="text-sm text-slate-400">
          Last updated: November 2026 · Dhiren Pathak Present Musical Housie
        </p>
      </header>

      <div className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 space-y-6 text-sm text-slate-300 leading-relaxed">
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">1. Information We Collect</h2>
          <p>
            Musical Housie is designed so you can host and join games without creating a permanent user account. When you start or join a game, we process only the display name you enter, your generated 6-character room code, your ticket marks, and an anonymous Firebase Authentication session identifier used strictly to synchronize live game state.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">2. Local Storage &amp; Session Recovery</h2>
          <p>
            We store lightweight session recovery data (your active room code, role, and display name) in your browser&apos;s local storage so you can rejoin an ongoing game if your page refreshes. You can clear this anytime by leaving the room or clearing browser site data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">3. Google AdSense &amp; Cookies</h2>
          <p>
            This website uses Google AdSense (Publisher ID: <code>ca-pub-8497938951597030</code>) to display advertisements on informational pages such as Home and How to Play. Third-party vendors, including Google, use cookies to serve ads based on a user&apos;s prior visits to this website or other websites.
          </p>
          <p>
            Google&apos;s use of advertising cookies enables it and its partners to serve ads to users based on their visit to this site and/or other sites on the Internet. Users may opt out of personalized advertising by visiting{' '}
            <a
              href="https://www.google.com/settings/ads"
              target="_blank"
              rel="noreferrer"
              className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
            >
              Google Ad Settings
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">4. YouTube Embedded Player &amp; Firebase</h2>
          <p>
            Music playback is provided through the official YouTube Embedded IFrame Player, and real-time room state is powered by Google Firebase Firestore and Anonymous Authentication. Interactions with embedded YouTube videos are subject to Google&apos;s Privacy Policy.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-white">5. Data Retention &amp; Contact</h2>
          <p>
            Temporary multiplayer room records exist only to run active and recently finished games and are periodically cleaned up. If you have questions regarding this Privacy Policy or wish to request removal of session data, contact us at{' '}
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
