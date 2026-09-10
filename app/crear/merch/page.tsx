import type { Metadata } from "next";
import { MerchCreatorClient } from "./MerchCreatorClient";
import { MerchCreatorStart } from "./MerchCreatorStart";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crear Merch | CLOUVA",
  description: "Convertí una idea, identidad o referencia en productos físicos, imágenes y publicaciones conectadas al Commerce canónico de CLOUVA.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CrearMerchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const projectId = Array.isArray(params.project) ? params.project[0] : params.project;

  if (projectId) return <MerchCreatorClient />;
  return <MerchCreatorStart />;
}
