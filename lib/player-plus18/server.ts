import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/supabase";

export class AdultAccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AdultAccessError";
    this.status = status;
  }
}

export function ageFromDateOfBirth(value: string) {
  const birth = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

export function validateDateOfBirth(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { valid: false as const, reason: "Fecha inválida." };
  const age = ageFromDateOfBirth(value);
  if (age == null || age < 0 || age > 120) return { valid: false as const, reason: "Fecha inválida." };
  return { valid: true as const, age, isAdult: age >= 18 };
}

export async function getAdultAccess(request: NextRequest) {
  const auth = await requireUser(request);
  const { data, error } = await auth.supabase
    .from("account_private_data")
    .select("date_of_birth")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) throw error;
  const birthDate = typeof data?.date_of_birth === "string" ? data.date_of_birth : null;
  const age = birthDate ? ageFromDateOfBirth(birthDate) : null;

  return {
    ...auth,
    birthDate,
    age,
    isAdult: typeof age === "number" && age >= 18,
    needsBirthDate: !birthDate,
  };
}

export async function requireAdultUser(request: NextRequest) {
  const access = await getAdultAccess(request);
  if (access.needsBirthDate) {
    throw new AdultAccessError("Confirmá tu edad para entrar a Player +18.", 403);
  }
  if (!access.isAdult) {
    throw new AdultAccessError("Player +18 está disponible únicamente para mayores de 18 años.", 403);
  }
  return access;
}
