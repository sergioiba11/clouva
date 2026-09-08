import type { Metadata } from "next";
import { MerchCreatorClient } from "./MerchCreatorClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crear Merch | CLOUVA",
  description: "Creá productos físicos, imágenes y publicaciones conectadas al Commerce canónico de CLOUVA.",
};

export default function CrearMerchPage() {
  return <MerchCreatorClient />;
}
