export type RatcraftPlanCode = "rata" | "rata_plus" | "rata_premium";

export type RatcraftPlan = {
  code: RatcraftPlanCode;
  name: string;
  priceUsd: number;
  short: string;
  benefits: string[];
};

export const RATCRAFT_PLANS: readonly RatcraftPlan[] = [
  {
    code: "rata",
    name: "Rata",
    priceUsd: 10,
    short: "Solo jugar",
    benefits: ["Acceso al servidor", "Whitelist Ratcraft", "Jugar con la banda"],
  },
  {
    code: "rata_plus",
    name: "Rata Plus",
    priceUsd: 20,
    short: "Jugar + ayudar a construir",
    benefits: ["Todo Rata", "Participar en construcción", "Acceso Builder cuando corresponda"],
  },
  {
    code: "rata_premium",
    name: "Rata Premium",
    priceUsd: 50,
    short: "Jugar + ayudar + herramientas + prioridad",
    benefits: ["Todo Rata Plus", "Herramientas Ratcraft", "Prioridad de acceso y funciones"],
  },
] as const;

export function getRatcraftPlan(value: unknown) {
  return RATCRAFT_PLANS.find((plan) => plan.code === value) ?? null;
}
