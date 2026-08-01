// Same minimal line-art treatment as clover-icon.tsx (the site's Flows
// mark) so the two currencies read as one family in the nav chip.
export function DiamondIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 9.5 8 4h8l4 5.5-9.5 10.5L4 9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M4 9.5h16M9 4l1.5 5.5L7 9.5M15 4l-1.5 5.5L17 9.5M10.5 9.5l1.5 10.5 1.5-10.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
