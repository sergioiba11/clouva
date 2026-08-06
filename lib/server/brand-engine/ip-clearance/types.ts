import type { ExternalBrandMatch } from "../types";

export type TrademarkNameQuery = {
  variants: string[];
  categories: string[];
  country: string | null;
};

export type VisualBrandQuery = {
  imageBytes: Buffer;
  categories: string[];
};

export type TrademarkSearchResult = ExternalBrandMatch & {
  registrationStatus: string | null;
  classes: string[];
};

export type VisualBrandMatch = ExternalBrandMatch;

export interface TrademarkSearchProvider {
  id: string;
  isAvailable(): boolean;
  searchName(input: TrademarkNameQuery): Promise<TrademarkSearchResult[]>;
}

export interface VisualBrandSearchProvider {
  id: string;
  isAvailable(): boolean;
  searchVisual(input: VisualBrandQuery): Promise<VisualBrandMatch[]>;
}
