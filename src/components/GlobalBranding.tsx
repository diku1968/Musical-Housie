export const PRESENTER_PORTRAIT_SRC = `${import.meta.env.BASE_URL}dp.png`;
export const BRAND_TEXT = 'Dhiren Pathak Present Musical Housie';

interface GlobalBrandingProps {
  variant?: 'header' | 'bar' | 'portrait';
  className?: string;
}

/**
 * Official global branding component displaying Dhiren Pathak's original photo asset
 * and the official "Dhiren Pathak Present Musical Housie" brand mark across all screens.
 * Preserves the exact original 706x589 image aspect ratio, quality, and appearance.
 */
export function GlobalBranding({ variant = 'header', className = '' }: GlobalBrandingProps) {
  if (variant === 'portrait') {
    return (
      <div
        className={`flex flex-col items-center gap-1 rounded-2xl border border-amber-400/70 bg-[#080B18]/90 backdrop-blur-sm p-1.5 shadow-2xl ${className}`}
      >
        <img
          src={PRESENTER_PORTRAIT_SRC}
          alt={BRAND_TEXT}
          width={706}
          height={589}
          className="w-24 sm:w-28 aspect-[706/589] rounded-xl object-contain"
        />
        <span className="text-[11px] font-bold text-amber-300 px-1 text-center leading-tight">
          Dhiren Pathak
        </span>
      </div>
    );
  }

  if (variant === 'bar') {
    return (
      <div
        className={`inline-flex items-center gap-3 rounded-2xl border border-amber-400/35 bg-[#090D1C]/85 px-3 py-2 ${className}`}
      >
        <img
          src={PRESENTER_PORTRAIT_SRC}
          alt={BRAND_TEXT}
          width={706}
          height={589}
          className="w-12 sm:w-14 aspect-[706/589] rounded-lg border border-amber-400/60 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300 leading-tight">
            Dhiren Pathak Present
          </div>
          <div className="font-display text-sm sm:text-base font-extrabold text-white leading-tight truncate">
            Musical Housie
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 text-left min-w-0 ${className}`}>
      <img
        src={PRESENTER_PORTRAIT_SRC}
        alt={BRAND_TEXT}
        width={706}
        height={589}
        className="w-12 sm:w-14 aspect-[706/589] rounded-lg border border-amber-400/70 shrink-0 object-contain"
      />
      <span className="font-display text-sm sm:text-base lg:text-lg font-bold tracking-tight text-white leading-tight truncate">
        <span className="text-amber-300">Dhiren Pathak Present</span> Musical Housie
      </span>
    </div>
  );
}
