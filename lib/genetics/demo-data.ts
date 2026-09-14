import type { Strain } from "@/lib/genetics/types";

export const PINA_EXPRESS_DEMO: Strain = {
  id: "demo-pina-express",
  slug: "pina-express",
  name: "Piña Express",
  subtitle: "Híbrida tropical",
  description: "Perfil de demostración para la experiencia de genéticas de CLOUVA.",
  strain_type: "Híbrida",
  hero_image: "/genetics/pina-express-bud.webp",
  profile: "Creativa y chill",
  tags: ["Tropical", "Creativa", "Equilibrada"],
  aromas: ["tropical", "cítrico", "pino"],
  is_featured: true,
  effects: {
    relaxation: 8,
    creativity: 9,
    energy: 6,
    happiness: 8,
    focus: 7,
  },
  terpenes: [
    { terpene: "Mirceno", description: null, aroma: null, relative_value: null, sort_order: 1 },
    { terpene: "Limoneno", description: null, aroma: null, relative_value: null, sort_order: 2 },
    { terpene: "Cariofileno", description: null, aroma: null, relative_value: null, sort_order: 3 },
  ],
  flavors: [
    { flavor: "Tropical", value: 9, sort_order: 1 },
    { flavor: "Cítrico", value: 8, sort_order: 2 },
    { flavor: "Pino", value: 6, sort_order: 3 },
    { flavor: "Dulce", value: 7, sort_order: 4 },
    { flavor: "Terroso", value: 4, sort_order: 5 },
    { flavor: "Floral", value: 3, sort_order: 6 },
  ],
};

export const LEARN_TOPICS = [
  { key: "genetica", title: "Genética", description: "Linajes, perfiles y cómo leer una ficha de variedad." },
  { key: "terpenos", title: "Terpenos", description: "Aromas y compuestos descritos sin inventar porcentajes." },
  { key: "aromas", title: "Aromas", description: "Cómo registrar perfiles sensoriales de forma consistente." },
  { key: "historia", title: "Historia", description: "Contexto cultural e histórico alrededor de las variedades." },
  { key: "ciencia", title: "Cannabis y ciencia", description: "Lecturas informativas con fuentes y lenguaje responsable." },
] as const;
