import Link from "next/link";
import { ObjectCreatorStudio } from "@/components/creator-studio/ObjectCreatorStudio";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Objetos 3D · CLOUVA Creator Studio",
  description: "Creá objetos y accesorios 3D desde una lámina multivista canónica.",
};

export default function CreatorObjectsPage() {
  return (
    <main className="min-h-screen bg-[#050507]">
      <div className="mx-auto max-w-[1100px] px-4 pt-4">
        <Link href="/creator-studio" className="text-xs font-semibold text-violet-300/70 hover:text-violet-200">
          ← Volver a Avatar & prendas
        </Link>
      </div>
      <ObjectCreatorStudio />
    </main>
  );
}
