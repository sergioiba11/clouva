export type CommerceShippingAddress = {
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

export type CommerceShippingMethod = {
  id: string;
  owner_type: "player" | "studio" | "clouva";
  player_id: string | null;
  studio_id: string | null;
  code: string;
  name: string;
  description: string | null;
  delivery_method: "shipping" | "pickup";
  carrier: string | null;
  pricing_type: "flat" | "free" | "adapter";
  flat_price: number | null;
  currency: string;
  adapter_key: string | null;
  config: Record<string, unknown> | null;
};

export type CommerceShippingQuote = {
  price: number;
  currency: string;
  carrier: string | null;
  serviceCode: string;
  metadata?: Record<string, unknown>;
};

export type CommerceShippingQuoteContext = {
  subtotal: number;
  itemCount: number;
  totalWeightGrams: number | null;
};

export interface CommerceShippingAdapter {
  quote(input: {
    method: CommerceShippingMethod;
    address: CommerceShippingAddress;
    context: CommerceShippingQuoteContext;
  }): Promise<CommerceShippingQuote>;
}

const adapters = new Map<string, CommerceShippingAdapter>();

export function registerCommerceShippingAdapter(key: string, adapter: CommerceShippingAdapter) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) throw new Error("La clave del adaptador de envío no puede estar vacía.");
  adapters.set(normalized, adapter);
}

export async function quoteCommerceShipping(
  method: CommerceShippingMethod,
  address: CommerceShippingAddress,
  context: CommerceShippingQuoteContext,
): Promise<CommerceShippingQuote> {
  if (method.pricing_type === "free") {
    return {
      price: 0,
      currency: method.currency,
      carrier: method.carrier,
      serviceCode: method.code,
    };
  }

  if (method.pricing_type === "flat") {
    const price = Number(method.flat_price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`El costo de envío de “${method.name}” no está configurado correctamente.`);
    }
    return {
      price,
      currency: method.currency,
      carrier: method.carrier,
      serviceCode: method.code,
    };
  }

  const adapterKey = method.adapter_key?.trim().toLowerCase();
  const adapter = adapterKey ? adapters.get(adapterKey) : null;
  if (!adapter) {
    throw new Error(`El transportista de “${method.name}” todavía no está conectado.`);
  }

  const quote = await adapter.quote({ method, address, context });
  if (!Number.isFinite(quote.price) || quote.price < 0) {
    throw new Error(`El transportista de “${method.name}” devolvió un costo inválido.`);
  }
  if (quote.currency !== method.currency) {
    throw new Error(`El transportista de “${method.name}” devolvió una moneda distinta.`);
  }
  return quote;
}
