"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, Crown, Hammer, Shield, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { getRatcraftPlan, RATCRAFT_PLANS, type RatcraftPlanCode } from "@/lib/ratcraft-access";

const ASSET_ROOT = "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other";
const LOGO = ASSET_ROOT + "/ratcraft_logo_principal.png";
const BACKGROUND = ASSET_ROOT + "/ratcraft_background_mobile_vertical.png";
const PUBLIC_HOST = "mc.clouva.com.ar";
const FALLBACK_IP = "34.39.153.27";

type PassStatus = {
  public_token: string;
  minecraft_name: string;
  edition: "java" | "bedrock";
  plan_code: RatcraftPlanCode;
  price_usd: number;
  amount: number;
  currency: "ARS";
  status: "pending" | "approved" | "rejected" | "cancelled" | "refunded";
  whitelist_status: "pending" | "queued" | "active" | "failed" | "removed";
  paid_at: string | null;
};

type CheckoutPayload = {
  initPoint: string;
  passToken: string;
  amountArs: number;
  fx: { localPerUsd: number; quotedAt: string };
};

function money(value: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(value);
}

function PlanIcon({ code }: { code: RatcraftPlanCode }) {
  if (code === "rata_premium") return <Crown className="h-5 w-5" />;
  if (code === "rata_plus") return <Hammer className="h-5 w-5" />;
  return <Shield className="h-5 w-5" />;
}

function CheckoutContent() {
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const queryPlan = params.get("plan");
  const initial = getRatcraftPlan(queryPlan)?.code ?? "rata";

  const [planCode, setPlanCode] = useState<RatcraftPlanCode>(initial);
  const [minecraftName, setMinecraftName] = useState("");
  const [edition, setEdition] = useState<"java" | "bedrock">("java");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pass, setPass] = useState<PassStatus | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const selected = useMemo(() => getRatcraftPlan(planCode)!, [planCode]);
  const passToken = params.get("pass");
  const returnState = params.get("return");

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const loadPass = useCallback(async () => {
    if (!passToken || !user) return null;
    const response = await authenticatedFetch("/api/minecraft/access/status?pass=" + encodeURIComponent(passToken), {
      cache: "no-store",
    });
    const payload = await readApiJson<{ pass: PassStatus }>(response);
    setPass(payload.pass);
    return payload.pass;
  }, [passToken, user]);

  useEffect(() => {
    if (!passToken || !user) return;
    void loadPass().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "No se pudo consultar el pase.");
    });
  }, [loadPass, passToken, user]);

  useEffect(() => {
    if (!passToken || !user || returnState !== "success") return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const current = await loadPass();
        if (current?.status === "approved" || attempts >= 12) return;
      } catch {
        if (attempts >= 12) return;
      }
      window.setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [loadPass, passToken, returnState, user]);

  const startCheckout = async () => {
    setWorking(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/minecraft/access/checkout", {
        method: "POST",
        headers: { "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ planCode, minecraftName, edition }),
      });
      const payload = await readApiJson<CheckoutPayload>(response);
      window.location.assign(payload.initPoint);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "No se pudo iniciar el pago.");
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07010d] text-white">
        <img src={LOGO} alt="Ratcraft" className="w-64 animate-pulse" />
      </main>
    );
  }

  const loginHref = "/login?intent=ratcraft&plan=" + encodeURIComponent(planCode);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07010d] text-white">
      <img src={BACKGROUND} alt="" className="fixed inset-0 h-full w-full object-cover opacity-35" />
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(217,70,239,.18),transparent_38%),linear-gradient(180deg,rgba(7,1,13,.52),rgba(7,1,13,.96))]" />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/minecraft" className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-300/15 bg-black/35 px-3 py-2 text-xs font-black text-white/75 backdrop-blur-md">
            <ArrowLeft className="h-4 w-4" /> Ratcraft
          </Link>
          <button
            type="button"
            onClick={() => void copy(PUBLIC_HOST, "host")}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 font-mono text-xs font-black text-emerald-100"
          >
            IP {PUBLIC_HOST} {copied === "host" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        <section className="mx-auto mt-7 max-w-3xl text-center">
          <img src={LOGO} alt="Ratcraft" className="mx-auto w-[min(78vw,420px)] drop-shadow-[0_16px_44px_rgba(217,70,239,.35)]" />
          <p className="mt-2 text-xs font-black uppercase tracking-[.22em] text-fuchsia-200/55">RATCRAFT × CLOUVA</p>
          <h1 className="mt-4 text-3xl font-black leading-tight sm:text-5xl">Estamos creando e iniciando este nuevo server.</h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-white/65 sm:text-lg">¿Querés formar parte? Elegí cómo querés entrar a Ratcraft.</p>

          <div className="mx-auto mt-5 grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={() => void copy(PUBLIC_HOST, "host2")} className="rounded-2xl border border-fuchsia-300/15 bg-black/40 px-4 py-3 text-left backdrop-blur-md">
              <span className="block text-[9px] font-black uppercase tracking-[.2em] text-fuchsia-200/40">Servidor</span>
              <span className="mt-1 flex items-center justify-between font-mono text-sm font-black"><span>{PUBLIC_HOST}</span><Copy className="h-4 w-4 text-white/35" /></span>
            </button>
            <button onClick={() => void copy(FALLBACK_IP, "ip")} className="rounded-2xl border border-fuchsia-300/15 bg-black/40 px-4 py-3 text-left backdrop-blur-md">
              <span className="block text-[9px] font-black uppercase tracking-[.2em] text-fuchsia-200/40">IP directa</span>
              <span className="mt-1 flex items-center justify-between font-mono text-sm font-black"><span>{FALLBACK_IP}</span><Copy className="h-4 w-4 text-white/35" /></span>
            </button>
          </div>
        </section>

        {pass ? (
          <section className="mx-auto mt-8 max-w-2xl rounded-[30px] border border-fuchsia-300/20 bg-black/55 p-5 shadow-[0_28px_90px_rgba(0,0,0,.42)] backdrop-blur-xl sm:p-7">
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-200/45">Tu pase</p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">{getRatcraftPlan(pass.plan_code)?.name || pass.plan_code}</h2>
                <p className="mt-1 font-mono text-sm text-white/55">{pass.minecraft_name} · {pass.edition.toUpperCase()}</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black">USD {Number(pass.price_usd)}</p>
                <p className="text-xs text-white/40">{money(Number(pass.amount))}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/[.07] bg-white/[.035] p-4">
              {pass.status === "approved" ? (
                <>
                  <div className="flex items-center gap-2 text-emerald-300"><Check className="h-5 w-5" /><b>Pago aprobado</b></div>
                  <p className="mt-2 text-sm text-white/65">
                    {pass.whitelist_status === "queued" || pass.whitelist_status === "active"
                      ? "Tu nick ya fue enviado a la whitelist de Ratcraft. Entrá con la IP de arriba."
                      : "El pago está aprobado. Estamos activando tu acceso al servidor."}
                  </p>
                </>
              ) : pass.status === "pending" ? (
                <>
                  <div className="flex items-center gap-2 text-amber-200"><Sparkles className="h-5 w-5" /><b>Pago en proceso</b></div>
                  <p className="mt-2 text-sm text-white/55">Cuando Mercado Pago confirme el pago, Ratcraft agrega tu nick a la whitelist.</p>
                </>
              ) : (
                <>
                  <p className="font-black text-rose-200">El pago no quedó activo.</p>
                  <p className="mt-2 text-sm text-white/55">Podés volver a elegir un rango y generar un nuevo checkout.</p>
                </>
              )}
            </div>

            <Link href="/minecraft" className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-fuchsia-500 px-5 py-3.5 font-black transition hover:bg-fuchsia-400">
              Volver a Ratcraft
            </Link>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-3 lg:grid-cols-3">
              {RATCRAFT_PLANS.map((plan) => {
                const active = plan.code === planCode;
                return (
                  <button
                    key={plan.code}
                    type="button"
                    onClick={() => setPlanCode(plan.code)}
                    className={"relative overflow-hidden rounded-[28px] border p-5 text-left transition sm:p-6 " + (active
                      ? "border-fuchsia-300/55 bg-fuchsia-400/[.13] shadow-[0_0_45px_rgba(217,70,239,.15)]"
                      : "border-white/[.09] bg-black/45 hover:border-fuchsia-300/30 hover:bg-fuchsia-400/[.06]")}
                  >
                    {plan.code === "rata_premium" ? (
                      <span className="absolute right-4 top-4 rounded-full bg-amber-300 px-2.5 py-1 text-[9px] font-black uppercase tracking-[.16em] text-black">Premium</span>
                    ) : null}
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100">
                      <PlanIcon code={plan.code} />
                    </div>
                    <h2 className="mt-4 text-2xl font-black">{plan.name}</h2>
                    <p className="mt-1 text-3xl font-black">USD {plan.priceUsd}</p>
                    <p className="mt-2 text-sm font-bold text-fuchsia-100/70">{plan.short}</p>
                    <div className="mt-5 space-y-2">
                      {plan.benefits.map((benefit) => (
                        <div key={benefit} className="flex items-start gap-2 text-sm text-white/60">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                          <span>{benefit}</span>
                        </div>
                      ))}
                    </div>
                    <div className={"mt-5 rounded-xl px-3 py-2.5 text-center text-xs font-black uppercase tracking-[.12em] " + (active ? "bg-fuchsia-500 text-white" : "bg-white/[.05] text-white/45")}>
                      {active ? "Elegido" : "Elegir"}
                    </div>
                  </button>
                );
              })}
            </section>

            <section className="mx-auto mt-5 max-w-2xl rounded-[30px] border border-fuchsia-300/20 bg-black/55 p-5 shadow-[0_28px_90px_rgba(0,0,0,.42)] backdrop-blur-xl sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[.2em] text-fuchsia-200/45">Acceso Ratcraft</p>
                  <h2 className="mt-1 text-2xl font-black">{selected.name}</h2>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black">USD {selected.priceUsd}</p>
                  <p className="text-[10px] text-white/35">pago único</p>
                </div>
              </div>

              <label className="mt-5 block">
                <span className="text-xs font-black uppercase tracking-[.14em] text-white/50">Tu nick de Minecraft</span>
                <input
                  value={minecraftName}
                  onChange={(event) => setMinecraftName(event.target.value)}
                  placeholder="Ej: Clouva"
                  maxLength={32}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3.5 font-mono text-base font-black outline-none transition placeholder:text-white/20 focus:border-fuchsia-300/45 focus:bg-fuchsia-400/[.04]"
                />
              </label>

              <div className="mt-4">
                <p className="text-xs font-black uppercase tracking-[.14em] text-white/50">Edición</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["java", "bedrock"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEdition(value)}
                      className={"rounded-2xl border px-4 py-3 text-sm font-black transition " + (edition === value
                        ? "border-fuchsia-300/45 bg-fuchsia-400/15 text-white"
                        : "border-white/[.08] bg-white/[.025] text-white/45")}
                    >
                      {value === "java" ? "Java / PC" : "Bedrock / Mobile"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/[.07] bg-white/[.03] p-4 text-sm text-white/55">
                El precio se muestra en USD. Mercado Pago procesa el equivalente en ARS usando la cotización oficial registrada al crear el checkout.
              </div>

              {!user ? (
                <Link href={loginHref} className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-fuchsia-500 px-5 py-4 font-black shadow-[0_0_28px_rgba(217,70,239,.2)] transition hover:bg-fuchsia-400">
                  Entrar a CLOUVA y continuar
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={working || !minecraftName.trim()}
                  onClick={() => void startCheckout()}
                  className="mt-4 w-full rounded-2xl bg-fuchsia-500 px-5 py-4 font-black shadow-[0_0_28px_rgba(217,70,239,.2)] transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {working ? "Abriendo Mercado Pago..." : `Pagar ${selected.name} · USD ${selected.priceUsd}`}
                </button>
              )}

              {error ? <p className="mt-3 rounded-xl border border-rose-300/15 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
            </section>
          </>
        )}

        <footer className="mt-9 pb-4 text-center">
          <p className="font-mono text-xs font-black text-white/45">IP {PUBLIC_HOST} · {FALLBACK_IP}:25565</p>
          <p className="mt-2 text-[9px] font-black uppercase tracking-[.28em] text-white/25">RATCRAFT × CLOUVA</p>
        </footer>
      </div>
    </main>
  );
}

export default function RatcraftCheckoutPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#07010d]" />}>
      <CheckoutContent />
    </Suspense>
  );
}
