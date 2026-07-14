"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AvatarCanvas } from "@/components/avatar-engine/AvatarCanvas";
import { AvatarControls } from "@/components/avatar-engine/AvatarControls";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";
import type { AvatarCategory } from "@/lib/avatar-engine/types";

export default function AvatarPage() {
  const [active, setActive] = useState<Exclude<AvatarCategory, "body">>("hair");
  const config = useAvatarStore((state) => state.config);
  const hydrate = useAvatarStore((state) => state.hydrate);

  useEffect(() => { void hydrate(); }, [hydrate]);

  return (
    <main className="avatar-engine-page" aria-label="CLOUVA Avatar Engine">
      <div className="avatar-engine-aura" aria-hidden="true" />
      <Link href="/" className="avatar-back"><ArrowLeft className="h-4 w-4" /> Volver</Link>
      <nav
        style={{ position: "absolute", top: "max(1rem, env(safe-area-inset-top))", left: 0, right: 0, zIndex: 20 }}
        className="flex justify-center"
      >
        <div className="mt-14 flex flex-nowrap max-w-[92vw] gap-2 overflow-x-auto rounded-full border border-white/10 bg-black/50 p-1.5 backdrop-blur">
          <Link href="/mi-flow/avatar-ia" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
            Generar con IA
          </Link>
          <Link href="/mi-flow/avatar-customizer" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
            Personalizar
          </Link>
          <Link href="/mi-flow/crear-prenda" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
            Crear prenda
          </Link>
          <Link href="/mi-flow/armario" className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
            Mi armario
          </Link>
        </div>
      </nav>
      <AvatarCanvas config={config} />
      <AvatarControls active={active} onActiveChange={setActive} />
    </main>
  );
}
