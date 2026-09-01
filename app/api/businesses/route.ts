import { NextRequest, NextResponse } from "next/server";
import { sanitizeSpotBusinessAnalysis, type SpotBusinessAnalysis } from "@/lib/commerce/spot-business";
import { createBusinessSpace, type BusinessKind } from "@/lib/server/business-spaces";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUSINESS_KINDS = new Set<BusinessKind>(["digital_business", "physical_business", "studio"]);

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      kind?: unknown;
      name?: unknown;
      description?: unknown;
      category?: unknown;
      subcategory?: unknown;
      location?: unknown;
      countryCode?: unknown;
      currency?: unknown;
      analysis?: SpotBusinessAnalysis | Record<string, unknown> | null;
    };

    const kind = short(body.kind, 40) as BusinessKind;
    const name = short(body.name, 160);
    const description = short(body.description, 4000);
    const category = short(body.category, 120);
    const subcategory = short(body.subcategory, 120);
    const location = short(body.location, 200);
    const countryCode = (short(body.countryCode, 2) || "AR").toUpperCase();
    const currency = (short(body.currency, 3) || (countryCode === "AR" ? "ARS" : "USD")).toUpperCase();

    if (!BUSINESS_KINDS.has(kind)) {
      return NextResponse.json({ error: "Tipo de negocio inválido.", code: "INVALID_BUSINESS_KIND" }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "El nombre del negocio es obligatorio." }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Contanos qué hace este negocio o espacio." }, { status: 400 });
    if (!category) return NextResponse.json({ error: "Elegí o escribí una categoría." }, { status: 400 });
    if (kind === "physical_business" && !location) {
      return NextResponse.json({ error: "Indicá la ubicación del negocio físico." }, { status: 400 });
    }
    if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "País o moneda inválidos." }, { status: 400 });
    }

    const analysis = body.analysis ? sanitizeSpotBusinessAnalysis(body.analysis) : null;
    const result = await createBusinessSpace({
      admin: createAdminSupabase(),
      userId: user.id,
      kind,
      name,
      description,
      category,
      subcategory,
      location,
      countryCode,
      currency,
      analysis,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo crear el negocio.",
        ...(typed.code ? { code: typed.code } : {}),
      },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
