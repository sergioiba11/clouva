export function CloverIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 12c0-2.5-2-4.5-4.5-4.5S3 9.5 3 12s2 4.5 4.5 4.5c1.6 0 3-.8 3.8-2.1M12 12c0-2.5 2-4.5 4.5-4.5S21 9.5 21 12s-2 4.5-4.5 4.5c-1.6 0-3-.8-3.8-2.1M12 12c2.5 0 4.5-2 4.5-4.5S14.5 3 12 3 7.5 5 7.5 7.5c0 1.6.8 3 2.1 3.8M12 12c-2.5 0-4.5 2-4.5 4.5S9.5 21 12 21s4.5-2 4.5-4.5c0-1.6-.8-3-2.1-3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 12v7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
