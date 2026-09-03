import type { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;

export type PrivateShippingAddress = {
  id: string;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_email: string | null;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
};

export class PurchaseEligibilityError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 422) {
    super(message);
    this.name = "PurchaseEligibilityError";
    this.status = status;
    this.code = code;
  }
}

export function isAdult(dateOfBirth: string | Date | null | undefined, now = new Date()) {
  if (!dateOfBirth) return false;
  const birth = dateOfBirth instanceof Date ? dateOfBirth : new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return false;

  const todayYear = now.getUTCFullYear();
  const todayMonth = now.getUTCMonth();
  const todayDay = now.getUTCDate();
  const birthMonth = birth.getUTCMonth();
  const birthDay = birth.getUTCDate();
  let age = todayYear - birth.getUTCFullYear();
  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) age -= 1;
  return age >= 18;
}

export async function getPurchaseEligibility(admin: AdminClient, userId: string) {
  const [{ data: privateData, error: privateError }, { data: addresses, error: addressError }] = await Promise.all([
    admin.from("account_private_data").select("date_of_birth").eq("user_id", userId).maybeSingle(),
    admin
      .from("user_addresses")
      .select("id,recipient_name,recipient_phone,recipient_email,address_line_1,address_line_2,city,province,postal_code,country,is_default,updated_at")
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);
  if (privateError) throw new Error(privateError.message);
  if (addressError) throw new Error(addressError.message);

  const dateOfBirth = privateData?.date_of_birth ?? null;
  const adult = isAdult(dateOfBirth);
  const defaultAddress = (addresses?.[0] ?? null) as (PrivateShippingAddress & { is_default: boolean; updated_at: string }) | null;
  return {
    dateOfBirth,
    isAdult: adult,
    hasAddress: Boolean(defaultAddress),
    defaultAddress,
    addresses: addresses ?? [],
  };
}

export async function requirePhysicalPurchaseEligibility(admin: AdminClient, userId: string) {
  const eligibility = await getPurchaseEligibility(admin, userId);
  if (!eligibility.dateOfBirth) {
    throw new PurchaseEligibilityError("Agregá tu fecha de nacimiento para comprar en CLOUVA.", "PURCHASE_BIRTH_DATE_REQUIRED");
  }
  if (!eligibility.isAdult) {
    throw new PurchaseEligibilityError("Necesitás ser mayor de 18 años para comprar en CLOUVA.", "PURCHASE_ADULT_REQUIRED", 403);
  }
  if (!eligibility.defaultAddress) {
    throw new PurchaseEligibilityError("Agregá una dirección privada de entrega para continuar.", "PURCHASE_ADDRESS_REQUIRED");
  }
  return eligibility;
}
