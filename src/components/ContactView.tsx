import { ArrowLeft, Globe, Mail, MessageSquare } from 'lucide-react';
import { GlobalBranding } from './GlobalBranding.tsx';

interface ContactViewProps {
  onBack: () => void;
}

export function ContactView({ onBack }: ContactViewProps) {
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
          Contact Us
        </h1>
        <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
          Have a question about hosting a Musical Housie game, reporting a technical issue, or asking about privacy and terms? Reach out directly using the details below.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-3xl border border-white/10 bg-[#121830] p-6 space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
            <Mail className="h-5 w-5" />
          </div>
          <h2 className="font-display text-xl font-bold text-white">Email Support</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            For feedback, bug reports, privacy requests, or general inquiries:
          </p>
          <a
            href="mailto:dhirenpathak1970@gmail.com"
            className="inline-flex items-center gap-2 font-mono text-sm font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-4 break-all"
          >
            dhirenpathak1970@gmail.com
          </a>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#121830] p-6 space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-300">
            <Globe className="h-5 w-5" />
          </div>
          <h2 className="font-display text-xl font-bold text-white">Official Website</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Always verify you are playing on the official Dhiren Pathak Present Musical Housie web app:
          </p>
          <a
            href="https://musical-housie.ai.studio/"
            className="inline-flex items-center gap-2 font-mono text-sm font-semibold text-indigo-300 hover:text-indigo-200 underline underline-offset-4 break-all"
          >
            https://musical-housie.ai.studio/
          </a>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#121830] p-6 sm:p-8 space-y-3">
        <div className="flex items-center gap-2.5 text-white">
          <MessageSquare className="h-5 w-5 text-emerald-400" />
          <h2 className="font-display text-lg font-bold">Helpful Details to Include When Writing</h2>
        </div>
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-slate-300">
          <li>Device and browser type (for example, Android Chrome, iPhone Safari, or Desktop).</li>
          <li>Whether the issue occurred while hosting a room or joining as a player.</li>
          <li>A brief description of the playlist or screen where you noticed the issue.</li>
        </ul>
      </section>
    </main>
  );
}
