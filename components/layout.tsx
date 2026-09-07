/**
 * @deprecated The authenticated CLOUVA system bar is mounted once from
 * app/layout.tsx through ClouvaSystemTopBarGate. Keep this compatibility
 * export temporarily so legacy pages do not need a risky all-at-once route
 * migration; rendering it locally would duplicate the canonical bar.
 */
export function MainNav() {
  return null;
}

export function MainFooter() {
  return <footer className="mx-auto max-w-7xl px-4 py-10 text-xs uppercase tracking-[0.18em] text-[var(--muted)] md:px-8">CLOUVA · Vida de flows</footer>;
}
