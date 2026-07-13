"use client";

import Link from "next/link";

type MinimalNavigationProps = { visible: boolean };

export function MinimalNavigation({ visible }: MinimalNavigationProps) {
  return (
    <nav className={`clouva-min-nav ${visible ? "clouva-min-nav-visible" : ""}`} aria-hidden={!visible}>
      <Link href="/">Home</Link>
      <Link href="/mi-flow/avatar">Avatar</Link>
    </nav>
  );
}
