"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AvatarCanvas } from "@/components/avatar-engine/AvatarCanvas";
import { AvatarControls } from "@/components/avatar-engine/AvatarControls";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";
import type { AvatarCategory } from "@/lib/avatar-engine/types";

export default function AvatarPage() {
  const [active, setActive] = useState<Exclude<AvatarCategory, "body">>("hair");
  const config = useAvatarStore((state) => state.config);

  return (
    <main className="avatar-engine-page" aria-label="CLOUVA Avatar Engine">
      <div className="avatar-engine-aura" aria-hidden="true" />
      <Link href="/" className="avatar-back"><ArrowLeft className="h-4 w-4" /> Volver</Link>
      <header className="avatar-engine-title">
        <span>CLOUVA Avatar Engine v1</span>
        <h1>Locker 3D modular</h1>
        <p>Personaje base + piezas intercambiables. Listo para conectar IA real más adelante.</p>
      </header>
      <AvatarCanvas config={config} />
      <AvatarControls active={active} onActiveChange={setActive} />
    </main>
  );
}
