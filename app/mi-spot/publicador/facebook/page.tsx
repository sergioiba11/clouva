"use client";

import { ArrowLeft, CheckCircle2, Facebook, Loader2, LogOut, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Overview = {
  spot: { id: string; name: string };
  facebook: {
    status: "not_connected" | "connected" | "requires_attention" | "expired";
    facebook_user_id: string | null;
    display_name: string | null;
    token_expires_at: string | null;
    scopes: string[];
    last_verified_at: string | null;
    attention_reason: string | null;
  };
  destinations: Array<{
    id: string;
    name: string;
    type: "marketplace" | "group" | "page";
    facebook_url: string | null;
    facebook_id: string | null;
    enabled: boolean;
  }>;
};

const BUTTON = "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:border-violet-300/30 hover:text-white disabled:opacity-40";

export default function FacebookSettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const [spotId, setSpotId] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveSpot = useCallback(async () => {
    const current = new URLSearchParams(window.location.search).get("spotId") || "";
    if (current) return current;
    const response = await authenticatedFetch("/api/mi-spot");
    const payload = await readApiJson<{ spots: Array<{ id: string; capabilities?: string[] }> }>(response);
    const spot = payload.spots.find((item) => item.capabilities?.includes("content")) ?? payload.spots[0];
    if (!spot) throw new Error("No tenés un Mi Spot disponible.");
    return spot.id;
  }, []);

  const load = useCallback(async (id: string) => {
    const response = await authenticatedFetch("/api/mi-spot/" + encodeURIComponent(id) + "/publisher");
    const payload = await readApiJson<Overview>(response);
    setData(payload);
  }, []);

  useEffect(() => {
    if (authLoading || !user) {
      if (!authLoading) setLoading(false);
      return;
    }
    let alive = true;
    resolveSpot().then(async (id) => {
      if (!alive) return;
      setSpotId(id);
      await load(id);
    }).catch((cause) => alive && setError(cause instanceof Error ? cause.message : "No se pudo cargar Facebook."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [authLoading, load, resolveSpot, user]);

  async function connect() {
    if (!spotId) return;
    setWorking(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/facebook/connect", {
        method: "POST",
        body: JSON.stringify({
          spotId,
          returnPath: "/mi-spot/publicador/facebook?spotId=" + encodeURIComponent(spotId),
        }),
      });
      const payload = await readApiJson<{ authorizationUrl: string }>(response);
      window.location.assign(payload.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar la conexión con Facebook.");
      setWorking(false);
    }
  }

  async function disconnect() {
    if (!spotId) return;
    setWorking(true);
    setError(null);
    try {
      await authenticatedFetch("/api/integrations/facebook/disconnect", {
        method: "POST",
        body: JSON.stringify({ spotId }),
      }).then((response) => readApiJson(response));
      await load(spotId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo desconectar Facebook.");
    } finally {
      setWorking(false);
    }
  }

  const status = data?.facebook.status ?? "not_connected";
  const pages = data?.destinations.filter((destination) => destination.type === "page") ?? [];

  return (
    <main className="min-h-screen bg-[#05040a] text-white">
      <MainNav />
      <div className="mx-auto max-w-3xl px-4 py-7 sm:px-8 sm:py-10">
        <Link href={spotId ? "/mi-spot/publicador?spotId=" + encodeURIComponent(spotId) : "/mi-spot/publicador"} className="inline-flex items-center gap-2 text-sm text-white/45 hover:text-white"><ArrowLeft size={15} /> Publicador</Link>

        <section className="mt-5 rounded-[28px] border border-violet-400/15 bg-gradient-to-br from-[#171022] via-[#0e0a17] to-[#09080f] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.16em] text-violet-200"><Facebook size={15} /> Mi Spot · Configuración</div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-5xl">Facebook</h1>
          <p className="mt-2 text-sm leading-6 text-white/45">La conexión guarda sólo tokens permitidos y cifrados en servidor. CLOUVA nunca pide ni almacena tu contraseña de Facebook.</p>
        </section>

        {loading ? <div className="mt-5 grid min-h-48 place-items-center rounded-3xl border border-white/[0.08] bg-[#0b0912]"><Loader2 size={18} className="animate-spin text-violet-300" /></div> : null}
        {error ? <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/[0.07] p-4 text-sm text-rose-100">{error}</div> : null}

        {!loading && user ? (
          <>
            <section className="mt-5 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[.15em] text-white/30">Estado</p>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusIcon status={status} />
                    <strong className="text-lg">{statusLabel(status)}</strong>
                  </div>
                  {data?.facebook.display_name ? <p className="mt-2 text-sm text-white/48">{data.facebook.display_name}</p> : null}
                  {data?.facebook.attention_reason ? <p className="mt-2 text-xs text-amber-100/75">{data.facebook.attention_reason}</p> : null}
                </div>
                {status === "connected" ? (
                  <button disabled={working} onClick={() => void disconnect()} className={BUTTON}>{working ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Desconectar</button>
                ) : (
                  <button disabled={working} onClick={() => void connect()} className="inline-flex items-center gap-2 rounded-xl bg-[#1877f2] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">{working ? <Loader2 size={14} className="animate-spin" /> : <Facebook size={14} />} CONECTAR FACEBOOK</button>
                )}
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <Info label="Última verificación" value={data?.facebook.last_verified_at ? new Date(data.facebook.last_verified_at).toLocaleString("es-AR") : "—"} />
                <Info label="Vencimiento token" value={data?.facebook.token_expires_at ? new Date(data.facebook.token_expires_at).toLocaleString("es-AR") : "—"} />
              </div>
            </section>

            <section className="mt-4 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5">
              <div className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 text-emerald-300" /><div><h2 className="font-semibold">Cómo trabaja CLOUVA</h2><p className="mt-1 text-xs leading-5 text-white/42">Páginas autorizadas pueden usar la Graph API. Marketplace y grupos se mantienen en modo asistido: CLOUVA prepara el job y se detiene si Facebook exige confirmación, 2FA, CAPTCHA o cualquier checkpoint.</p></div></div>
            </section>

            <section className="mt-4 rounded-[24px] border border-white/[0.08] bg-[#0b0912] p-5">
              <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.15em] text-white/30">Páginas detectadas</p><h2 className="mt-1 text-lg font-semibold">{pages.length}</h2></div><button disabled={working || status !== "connected"} onClick={() => void connect()} className={BUTTON}><RefreshCw size={13} /> Renovar permisos</button></div>
              <div className="mt-3 space-y-2">
                {pages.map((page) => <div key={page.id} className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-sm font-semibold">{page.name}</p><p className="mt-1 text-[10px] text-white/35">Página · {page.facebook_id || "sin id"} · {page.enabled ? "activa" : "inactiva"}</p></div>)}
                {!pages.length ? <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-xs text-white/35">Todavía no hay Páginas conectadas.</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "connected") return <CheckCircle2 size={18} className="text-emerald-300" />;
  if (status === "requires_attention" || status === "expired") return <TriangleAlert size={18} className="text-amber-300" />;
  return <Facebook size={18} className="text-white/35" />;
}

function statusLabel(status: string) {
  if (status === "connected") return "Conectado";
  if (status === "requires_attention") return "Requiere atención";
  if (status === "expired") return "Sesión vencida";
  return "No conectado";
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-[9px] uppercase tracking-[.12em] text-white/30">{label}</p><p className="mt-1 text-xs text-white/65">{value}</p></div>;
}
