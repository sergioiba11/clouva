import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminSearchResult = {
  id: string;
  kind: "user" | "player" | "studio" | "product" | "order" | "booking" | "command";
  label: string;
  secondary: string | null;
  imageUrl: string | null;
  href: string;
};

async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,role_v2")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (profile?.role !== "admin" && profile?.role_v2 !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }

  return admin;
}

function cleanSearchTerm(value: string) {
  return value.replace(/[%(),]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function matchesCommand(query: string, words: string[]) {
  return words.some((word) => word.includes(query) || query.includes(word));
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const query = cleanSearchTerm(request.nextUrl.searchParams.get("q") ?? "").toLowerCase();
    if (query.length < 2) return NextResponse.json({ results: [] satisfies AdminSearchResult[] });

    const pattern = `%${query}%`;
    const [profilesResult, playersResult, studiosResult, productsResult, ordersResult, bookingsResult] = await Promise.all([
      admin
        .from("profiles")
        .select("id,full_name,username,email,clouva_id,avatar_url,is_blocked,role,role_v2")
        .or(`full_name.ilike.${pattern},username.ilike.${pattern},email.ilike.${pattern},clouva_id.ilike.${pattern}`)
        .limit(6),
      admin
        .from("players")
        .select("id,display_name,slug,is_published,publication_status,profile_image_url")
        .or(`display_name.ilike.${pattern},slug.ilike.${pattern}`)
        .limit(6),
      admin
        .from("studios")
        .select("id,name,slug,is_published,logo_url")
        .or(`name.ilike.${pattern},slug.ilike.${pattern}`)
        .limit(6),
      admin
        .from("commerce_products")
        .select("id,name,status,owner_type")
        .ilike("name", pattern)
        .limit(6),
      admin
        .from("commerce_orders")
        .select("id,status,payment_status,fulfillment_status,created_at")
        .order("created_at", { ascending: false })
        .limit(120),
      admin
        .from("bookings")
        .select("id,status,payment_status,scheduled_at")
        .order("scheduled_at", { ascending: false })
        .limit(120),
    ]);

    const results: AdminSearchResult[] = [];

    for (const row of profilesResult.data ?? []) {
      results.push({
        id: row.id,
        kind: "user",
        label: row.full_name || row.username || row.email || "Usuario",
        secondary: `${row.email || row.clouva_id || "Cuenta CLOUVA"} · ${row.is_blocked ? "Bloqueado" : row.role_v2 || row.role || "cliente"}`,
        imageUrl: row.avatar_url || null,
        href: "/admin/clientes",
      });
    }

    for (const row of playersResult.data ?? []) {
      results.push({
        id: row.id,
        kind: "player",
        label: row.display_name || row.slug,
        secondary: row.is_published ? "Player publicado" : row.publication_status || "Player sin publicar",
        imageUrl: row.profile_image_url || null,
        href: `/admin/clientes`,
      });
    }

    for (const row of studiosResult.data ?? []) {
      results.push({
        id: row.id,
        kind: "studio",
        label: row.name,
        secondary: row.is_published ? "Estudio publicado" : "Estudio sin publicar",
        imageUrl: row.logo_url || null,
        href: `/studio-dashboard/${row.id}`,
      });
    }

    for (const row of productsResult.data ?? []) {
      results.push({
        id: row.id,
        kind: "product",
        label: row.name,
        secondary: `${row.owner_type || "clouva"} · ${row.status || "sin estado"}`,
        imageUrl: null,
        href: "/admin/marketplace",
      });
    }

    const normalizedIdQuery = query.replace(/^#/, "");
    for (const row of ordersResult.data ?? []) {
      if (!String(row.id).toLowerCase().includes(normalizedIdQuery)) continue;
      results.push({
        id: row.id,
        kind: "order",
        label: `Pedido #${String(row.id).slice(0, 8)}`,
        secondary: `${row.payment_status || "pago pendiente"} · ${row.fulfillment_status || row.status || "pendiente"}`,
        imageUrl: null,
        href: "/admin/marketplace",
      });
      if (results.filter((item) => item.kind === "order").length >= 4) break;
    }

    for (const row of bookingsResult.data ?? []) {
      if (!String(row.id).toLowerCase().includes(normalizedIdQuery)) continue;
      results.push({
        id: row.id,
        kind: "booking",
        label: `Reserva #${String(row.id).slice(0, 8)}`,
        secondary: `${row.status || "pendiente"} · ${row.payment_status || "sin pago"}`,
        imageUrl: null,
        href: "/admin/reservas",
      });
      if (results.filter((item) => item.kind === "booking").length >= 4) break;
    }

    const commands: Array<{ id: string; label: string; href: string; words: string[] }> = [
      { id: "assets", label: "Abrir Asset Explorer", href: "/admin/assets", words: ["asset", "assets", "archivo", "storage"] },
      { id: "treasury", label: "Abrir Tesorería FLOW", href: "/admin/flows/tesoreria", words: ["tesoreria", "reserva", "backing", "flow"] },
      { id: "cash", label: "Registrar pago efectivo", href: "/admin/flows/pagos-manuales", words: ["efectivo", "pago manual", "registrar pago"] },
      { id: "lab", label: "Abrir CLOUVA Lab", href: "/admin/clouva-lab", words: ["lab", "interfaz", "home", "publicar"] },
      { id: "control", label: "Abrir CLOUVA Control", href: "/admin/clouva-control", words: ["control", "apk", "android"] },
      { id: "studio-os", label: "Abrir Studio OS", href: "/admin/estudios/studio-os", words: ["studio os", "studio", "precio estudio"] },
      { id: "settings", label: "Abrir Configuración", href: "/admin/configuracion", words: ["configuracion", "ajustes", "settings"] },
      { id: "new-product", label: "Crear producto", href: "/admin/productos/nuevo", words: ["crear producto", "nuevo producto", "producto"] },
      { id: "avatar", label: "Administrar Avatar Oficial", href: "/admin/avatar-oficial", words: ["avatar", "glb oficial", "avatar oficial"] },
    ];

    for (const command of commands) {
      if (!matchesCommand(query, command.words)) continue;
      results.push({
        id: command.id,
        kind: "command",
        label: command.label,
        secondary: "Acción administrativa",
        imageUrl: null,
        href: command.href,
      });
    }

    return NextResponse.json(
      { results: results.slice(0, 18) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo ejecutar la búsqueda administrativa.";
    return NextResponse.json({ error: message, results: [] }, { status });
  }
}
