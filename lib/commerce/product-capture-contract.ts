export const PRODUCT_CAPTURE_LABELS = ["Frente", "Atrás", "Detalle"] as const;
export type ProductCaptureLabel = typeof PRODUCT_CAPTURE_LABELS[number];

export const MAX_PRODUCT_DETAIL_IMAGES = 12;
export const MAX_PRODUCT_REFERENCE_IMAGES = MAX_PRODUCT_DETAIL_IMAGES + 2;
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_TOTAL_BYTES = 24 * 1024 * 1024;

export function canonicalProductCaptureLabel(value: unknown): ProductCaptureLabel | null {
  if (value === "Frente" || value === "Atrás" || value === "Detalle") return value;
  // Compatibilidad con capturas creadas antes del cambio de nombre.
  if (value === "Dorso") return "Atrás";
  return null;
}

export function countProductCaptureLabels(labels: ProductCaptureLabel[]) {
  return labels.reduce((counts, label) => {
    if (label === "Frente") counts.front += 1;
    else if (label === "Atrás") counts.back += 1;
    else counts.detail += 1;
    return counts;
  }, { front: 0, back: 0, detail: 0 });
}

export function orderProductCaptures<T extends { label: ProductCaptureLabel }>(captures: T[]) {
  return [
    ...captures.filter((capture) => capture.label === "Frente"),
    ...captures.filter((capture) => capture.label === "Atrás"),
    ...captures.filter((capture) => capture.label === "Detalle"),
  ];
}
