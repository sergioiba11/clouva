import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

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
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = (await request.json().catch(() => null)) as
      | { to?: unknown; subject?: unknown; message?: unknown }
      | null;

    const to = clean(body?.to).toLowerCase();
    const subject = clean(body?.subject);
    const message = clean(body?.message);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json({ error: "Email de destino inválido." }, { status: 400 });
    }
    if (!subject || subject.length > 180) {
      return NextResponse.json({ error: "El asunto es obligatorio y debe tener hasta 180 caracteres." }, { status: 400 });
    }
    if (!message || message.length > 20_000) {
      return NextResponse.json({ error: "El mensaje es obligatorio y debe tener hasta 20.000 caracteres." }, { status: 400 });
    }

    const apiKey = clean(process.env.RESEND_API_KEY);
    if (!apiKey) {
      return NextResponse.json({ error: "RESEND_API_KEY no está configurada en producción." }, { status: 503 });
    }

    const from = clean(process.env.CLOUVA_EMAIL_FROM) || "CLOUVA <admin@clouva.com.ar>";
    const digest = createHash("sha256").update(`${to}\n${subject}\n${message}`).digest("hex").slice(0, 32);
    const htmlMessage = escapeHtml(message).replaceAll("\n", "<br>");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `job-outreach/${digest}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: "admin@clouva.com.ar",
        subject,
        text: message,
        html: `<!doctype html><html><body style="margin:0;background:#07080d;color:#f5f7ff;font-family:Arial,sans-serif"><div style="max-width:640px;margin:auto;padding:32px 20px"><div style="font-size:12px;font-weight:800;letter-spacing:.18em;color:#9f8cff;margin-bottom:24px">CLOUVA</div><div style="font-size:15px;line-height:1.7;color:#e8eaf2">${htmlMessage}</div><div style="margin-top:30px;padding-top:18px;border-top:1px solid #242633;font-size:12px;color:#777d91">Sergio Ibañez · CLOUVA<br><a href="https://clouva.com.ar" style="color:#a998ff">clouva.com.ar</a></div></div></body></html>`,
        tags: [{ name: "category", value: "job_outreach" }],
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.message || `Resend respondió ${response.status}.` },
        { status: response.status >= 400 && response.status < 500 ? 400 : 502 },
      );
    }

    return NextResponse.json({ ok: true, id: payload?.id ?? null, to, from });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo enviar el correo.";
    return NextResponse.json({ error: message }, { status });
  }
}
