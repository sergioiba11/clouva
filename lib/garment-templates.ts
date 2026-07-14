/**
 * Templates oficiales de prendas CLOUVA.
 *
 * Estado real al momento de escribir esto: NINGÚN template oficial
 * existe todavía (nadie subió los GLB pre-riggeados). Esta función
 * NUNCA debe inventar una URL — solo confirma si el archivo existe de
 * verdad en Storage, y si no, devuelve un mensaje claro para que la UI
 * lo muestre honestamente en vez de fingir que hay una base oficial.
 */

export const FUNCTIONAL_GARMENT_CATEGORIES = ["hoodie", "shirt", "jacket", "pants", "shorts", "shoes"] as const;
export type FunctionalGarmentCategory = (typeof FUNCTIONAL_GARMENT_CATEGORIES)[number];

const TEMPLATE_STORAGE_PATH: Record<FunctionalGarmentCategory, string> = {
  hoodie: "official/garments/hoodie-base.glb",
  shirt: "official/garments/shirt-base.glb",
  jacket: "official/garments/jacket-base.glb",
  pants: "official/garments/pants-base.glb",
  shorts: "official/garments/shorts-base.glb",
  shoes: "official/garments/shoes-base.glb",
};

export function isFunctionalGarmentCategory(category: string): category is FunctionalGarmentCategory {
  return (FUNCTIONAL_GARMENT_CATEGORIES as readonly string[]).includes(category);
}

export function officialTemplateUrl(category: FunctionalGarmentCategory) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/avatars/${TEMPLATE_STORAGE_PATH[category]}`;
}

export type TemplateCheckResult =
  | { available: true; url: string }
  | { available: false; message: string };

/**
 * Chequea si el template oficial de una categoría existe de verdad
 * (HEAD request real a Storage), sin asumir nada.
 */
export async function checkOfficialTemplate(category: string): Promise<TemplateCheckResult> {
  if (!isFunctionalGarmentCategory(category)) {
    return { available: false, message: "Esta categoría no usa templates oficiales (flujo experimental)." };
  }
  const url = officialTemplateUrl(category);
  if (!url) return { available: false, message: "Falta configurar el template oficial de esta categoría." };

  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!response.ok) return { available: false, message: "Falta configurar el template oficial de esta categoría." };
    return { available: true, url };
  } catch {
    return { available: false, message: "Falta configurar el template oficial de esta categoría." };
  }
}
