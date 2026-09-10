export type MerchProductKey =
  | "shirt"
  | "pants"
  | "hoodie"
  | "flat_cap"
  | "cap"
  | "headphones"
  | "socks"
  | "mug"
  | "grinder"
  | "custom";

export type MerchProductType = {
  key: MerchProductKey;
  label: string;
  group: "Ropa" | "Gorras" | "Tecnología" | "Objetos" | "Accesorios";
  description: string;
  variants: string;
  icon: "shirt" | "package" | "headphones" | "coffee" | "gem" | "box";
};

export const MERCH_PRODUCT_TYPES: readonly MerchProductType[] = [
  {
    key: "shirt",
    label: "Remera",
    group: "Ropa",
    description: "Remera del drop con gráfica o identidad aplicada.",
    variants: "S,M,L,XL",
    icon: "shirt",
  },
  {
    key: "pants",
    label: "Pantalón",
    group: "Ropa",
    description: "Pantalón de la colección con lenguaje visual compartido.",
    variants: "S,M,L,XL",
    icon: "package",
  },
  {
    key: "hoodie",
    label: "Buzo Hoodie",
    group: "Ropa",
    description: "Hoodie del drop con frente, espalda y detalles coherentes.",
    variants: "S,M,L,XL",
    icon: "shirt",
  },
  {
    key: "flat_cap",
    label: "Gorra plana",
    group: "Gorras",
    description: "Snapback o gorra de visera plana.",
    variants: "Único",
    icon: "package",
  },
  {
    key: "cap",
    label: "Gorra clásica",
    group: "Gorras",
    description: "Baseball cap / dad cap de la colección.",
    variants: "Único",
    icon: "package",
  },
  {
    key: "headphones",
    label: "Auriculares",
    group: "Tecnología",
    description: "Auriculares intervenidos por la identidad visual del drop.",
    variants: "Único",
    icon: "headphones",
  },
  {
    key: "socks",
    label: "Medias",
    group: "Ropa",
    description: "Medias con patrón, símbolo o gráfica de la colección.",
    variants: "S/M,L/XL",
    icon: "package",
  },
  {
    key: "mug",
    label: "Taza",
    group: "Objetos",
    description: "Taza comercial con identidad aplicada.",
    variants: "Único",
    icon: "coffee",
  },
  {
    key: "grinder",
    label: "Picador",
    group: "Objetos",
    description: "Objeto personalizado con acabado y forma del drop.",
    variants: "Único",
    icon: "box",
  },
  {
    key: "custom",
    label: "Accesorio personalizado",
    group: "Accesorios",
    description: "Aros, dijes, anillos, llaveros u otra pieza con forma propia.",
    variants: "Único",
    icon: "gem",
  },
] as const;

export const CUSTOM_ACCESSORY_TYPES = ["Aros", "Dije", "Collar", "Anillo", "Pulsera", "Llavero", "Otro"] as const;
export type CustomAccessoryType = (typeof CUSTOM_ACCESSORY_TYPES)[number];

export const DESIGN_USE_OPTIONS = [
  { value: "graphic", label: "Gráfico", description: "Aplicar el diseño sobre el producto." },
  { value: "shape", label: "Forma", description: "Usar el diseño para definir la forma física." },
  { value: "both", label: "Ambos", description: "La forma y el acabado nacen del diseño." },
] as const;
export type DesignUse = (typeof DESIGN_USE_OPTIONS)[number]["value"];

export function merchProductType(key: string) {
  return MERCH_PRODUCT_TYPES.find((item) => item.key === key) ?? null;
}
