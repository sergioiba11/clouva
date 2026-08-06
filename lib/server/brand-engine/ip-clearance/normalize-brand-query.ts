import "server-only";

export function normalizeBrandText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es-AR")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildBrandSearchVariants(displayName: string, descriptor: string | null): string[] {
  const normalizedName = normalizeBrandText(displayName);
  const normalizedDescriptor = normalizeBrandText(descriptor);
  const candidates = new Set<string>();
  if (displayName.trim()) candidates.add(displayName.trim());
  if (normalizedName) candidates.add(normalizedName);
  if (descriptor?.trim()) candidates.add(`${displayName.trim()} ${descriptor.trim()}`.trim());
  if (normalizedName && normalizedDescriptor) candidates.add(`${normalizedName} ${normalizedDescriptor}`);
  if (normalizedName.startsWith("EL ")) candidates.add(normalizedName.slice(3));
  else if (normalizedName) candidates.add(`EL ${normalizedName}`);
  return Array.from(candidates).filter(Boolean);
}
