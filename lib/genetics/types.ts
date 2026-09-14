export type StrainEffects = {
  relaxation: number | null;
  creativity: number | null;
  energy: number | null;
  happiness: number | null;
  focus: number | null;
};

export type StrainTerpene = {
  id?: string;
  terpene: string;
  description: string | null;
  aroma: string | null;
  relative_value: number | null;
  sort_order?: number;
};

export type StrainFlavor = {
  id?: string;
  flavor: string;
  value: number | null;
  sort_order?: number;
};

export type Strain = {
  id: string;
  slug: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  strain_type: string | null;
  hero_image: string | null;
  profile: string | null;
  tags: string[];
  aromas: string[];
  is_featured: boolean;
  effects: StrainEffects | null;
  terpenes: StrainTerpene[];
  flavors: StrainFlavor[];
};

export type VisualMatch = {
  slug: string;
  name: string;
  similarity: number | null;
  rationale: string[];
};

export type ScanAnalysis = {
  visibleCharacteristics: string[];
  visualMatches: VisualMatch[];
  notes: string;
};

export type ScanHistoryItem = {
  id: string;
  created_at: string;
  analysis: ScanAnalysis;
};
