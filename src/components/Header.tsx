import { GlobalBranding } from './GlobalBranding.tsx';

export type AppScreen =
  | 'home'
  | 'host-create'
  | 'join'
  | 'host-room'
  | 'player-room'
  | 'how-to-play';

interface HeaderProps {
  currentScreen: AppScreen;
  inActiveRoom: boolean;
  onNavigate: (screen: AppScreen) => void;
  onOpenSetupGuide: () => void;
  onLeaveRoom: () => void;
}

export function Header({
  currentScreen,
  inActiveRoom,
  onNavigate,
  onOpenSetupGuide,
  onLeaveRoom,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#080B18]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 sm:px-6 py-3.5">
        {/* Zone 1: Official Global Branding */}
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="text-left min-w-0 hover:opacity-90 transition-opacity cursor-pointer"
        >
          <GlobalBranding variant="header" />
        </button>

        {/* Zone 2: Clean single-line text nav links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer hover:text-white ${
              currentScreen === 'home' ? 'text-white underline underline-offset-4 decoration-amber-400' : ''
            }`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => onNavigate('how-to-play')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer hover:text-white ${
              currentScreen === 'how-to-play' ? 'text-white underline underline-offset-4 decoration-amber-400' : ''
            }`}
          >
            How to Play
          </button>
          <button
            type="button"
            onClick={onOpenSetupGuide}
            className="whitespace-nowrap shrink-0 transition-colors cursor-pointer hover:text-white"
          >
            Setup Guide
          </button>
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center gap-3 shrink-0">
          {inActiveRoom ? (
            <button
              type="button"
              onClick={onLeaveRoom}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-100 hover:bg-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Leave Room
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('host-create')}
              className="rounded-xl bg-amber-400 px-4 py-2 text-xs sm:text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Host a Game
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
