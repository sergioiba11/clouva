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
      <Link href="/mi-flow/avatar-ia" style={{ position: "absolute", top: 78, right: 16, zIndex: 20 }} className="avatar-back">
        Generar con IA
      </Link>
      <Link href="/mi-flow/avatar-customizer" style={{ position: "absolute", top: 78, left: 96, zIndex: 20 }} className="avatar-back">
        Personalizar
      </Link>
      <Link href="/mi-flow/crear-prenda" style={{ position: "absolute", top: 130, left: 16, zIndex: 20 }} className="avatar-back">
        Crear prenda
      </Link>
      <Link href="/mi-flow/armario" style={{ position: "absolute", top: 130, right: 16, zIndex: 20 }} className="avatar-back">
        Mi armario
      </Link>
      <AvatarCanvas config={config} />
      <AvatarControls active={active} onActiveChange={setActive} />
    </main>
  );
}
