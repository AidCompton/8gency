// The 8gency mark: one continuous loop drawn as an 8, on a violet tile. Work
// goes round (brief, make, approve, bill) and nothing falls out of the loop.
export const LOOP_PATH =
  "M16 16C13.2 13.6 10 12.6 10 10.1 10 7.9 12.7 6.6 16 6.6s6 1.3 6 3.5c0 2.5-3.2 3.5-6 5.9zm0 0c-3.1 2.4-6.6 3.5-6.6 6.2 0 2.4 3 3.8 6.6 3.8s6.6-1.4 6.6-3.8c0-2.7-3.5-3.8-6.6-6.2z";

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <defs>
        <linearGradient id="8g-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b61ff" />
          <stop offset="1" stopColor="#4b2bdf" />
        </linearGradient>
        <linearGradient id="8g-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#8g-tile)" />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="url(#8g-sheen)" stroke="#fff" strokeOpacity=".14" />
      <path d={LOOP_PATH} fill="none" stroke="#fff" strokeWidth="3.1" strokeLinejoin="round" />
    </svg>
  );
}
