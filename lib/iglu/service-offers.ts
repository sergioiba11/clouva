import type { IgluOffer } from "@/components/iglu/IgluPages";
import type { StudioService } from "@/lib/players-data";

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function realPrice(service: StudioService) {
  if (service.price == null) return {};
  const price = Number(service.price);
  if (!Number.isFinite(price)) return {};

  const currency = normalize(service.currency).toUpperCase();
  if (currency === "USD") return { usd: price };
  if (currency === "ARS") return { ars: price.toLocaleString("es-AR") };
  return {};
}

function matchesService(service: StudioService, keywords: string[]) {
  const haystack = normalize([service.name, service.category, service.description].filter(Boolean).join(" "));
  return keywords.some((keyword) => haystack.includes(normalize(keyword)));
}

export function resolveIgluServiceOffers(
  services: StudioService[],
  keywords: string[],
  fallback: IgluOffer[],
): IgluOffer[] {
  const matched = services.filter((service) => matchesService(service, keywords));

  if (!matched.length) {
    return fallback.map((offer) => ({
      ...offer,
      usd: undefined,
      flows: undefined,
      ars: undefined,
      badge: offer.badge ?? "Consultar",
      href: offer.href ?? "/iglu/contacto#reservar",
    }));
  }

  return matched.map((service) => {
    const price = realPrice(service);
    const hasRealPrice = price.usd != null || price.ars != null;

    return {
      name: service.name,
      description: service.description || service.category || "Servicio profesional IGLÚ.",
      ...price,
      badge: hasRealPrice ? undefined : "Consultar",
      image: service.image_url || undefined,
      href: "/iglu/contacto#reservar",
    };
  });
}
