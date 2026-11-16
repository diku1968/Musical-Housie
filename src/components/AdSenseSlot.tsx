import { useEffect, useRef, useState } from 'react';

const ADSENSE_CLIENT_ID = 'ca-pub-8497938951597030';

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

interface AdSenseSlotProps {
  adSlot?: string;
  label?: string;
  className?: string;
}

/**
 * Reusable, policy-compliant Google AdSense responsive display ad component.
 * - Intended only for Home (slot 7471293220) and How to Play (slot 7886226195).
 * - Never mount on Host Game, Player Game, YouTube Player, Tickets, or Claim Win areas.
 * - Initializes window.adsbygoogle safely on mount and prevents duplicate push() calls across re-renders.
 * - Shows a clean empty reserved ad container when approval or ad serving is pending (never fake ads).
 */
export function AdSenseSlot({ adSlot, label = 'Advertisement', className = '' }: AdSenseSlotProps) {
  const cleanSlot = (adSlot || '').trim();
  const isValidSlot = /^\d{6,20}$/.test(cleanSlot);

  const insRef = useRef<HTMLModElement | null>(null);
  const pushedSlotRef = useRef<string>('');
  const [adStatus, setAdStatus] = useState<'pending' | 'filled' | 'unfilled'>('pending');

  useEffect(() => {
    if (!isValidSlot || typeof window === 'undefined') return;
    const el = insRef.current;
    if (!el) return;

    const syncStatus = () => {
      const status = el.getAttribute('data-ad-status');
      if (status === 'unfilled') {
        setAdStatus('unfilled');
      } else if (status === 'filled') {
        setAdStatus('filled');
      }
    };

    syncStatus();

    const observer = new MutationObserver(syncStatus);
    observer.observe(el, { attributes: true, attributeFilter: ['data-ad-status'] });

    // Prevent duplicate adsbygoogle.push({}) calls on re-renders or remounts of the same <ins> element
    const alreadyDone =
      pushedSlotRef.current === cleanSlot ||
      el.dataset.adPushed === 'true' ||
      el.getAttribute('data-adsbygoogle-status') === 'done';

    if (!alreadyDone) {
      pushedSlotRef.current = cleanSlot;
      el.dataset.adPushed = 'true';
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        // Safe fallback if AdSense script is blocked or still loading
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [cleanSlot, isValidSlot]);

  if (!isValidSlot) {
    return null;
  }

  return (
    <aside
      aria-label={label}
      className={`block w-full min-h-[104px] overflow-hidden rounded-2xl border px-4 py-3 ${
        adStatus === 'filled'
          ? 'border-white/10 bg-[#0D1326]'
          : 'border-white/10 bg-[#0D1326]/40'
      } ${className}`}
    >
      {adStatus === 'filled' && (
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-center">
          {label}
        </div>
      )}
      <ins
        key={cleanSlot}
        ref={insRef}
        className="adsbygoogle block w-full min-h-[90px] text-center"
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={cleanSlot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
