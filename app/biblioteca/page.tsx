import type { Metadata } from "next";
import { ActiveAvatarDownload } from "@/components/library/ActiveAvatarDownload";
import { ClouvaLibrary } from "@/components/library/ClouvaLibrary";
import { UnrealAvatarExport } from "@/components/library/UnrealAvatarExport";
import { UnrealObjectExport } from "@/components/library/UnrealObjectExport";

export const metadata: Metadata = {
  title: "Biblioteca | CLOUVA",
  description: "Tus modelos 3D, imágenes, sonidos y videos en un mismo lugar.",
};

export default function BibliotecaPage() {
  return (
    <>
      <ActiveAvatarDownload />
      <UnrealAvatarExport />
      <UnrealObjectExport />
      <ClouvaLibrary />
    </>
  );
}
