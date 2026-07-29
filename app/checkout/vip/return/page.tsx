"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type VipState = {
  subscription: { status: string } | null;
  entitlement: { status: string; tier: string } | null;
};

export default function VipReturnPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [message, setMessage] = useState("Mercado Pago recibió la operación. Esperando verificación segura...");

  useEffect(() => { if (!loading && !user) router.replace("/login?next=/vip"); }, [loading, router, user]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      try {
        const response = await authenticatedFetch("/api/billing/vip");
        const state = await readApiJson<VipState>(response);
        if (cancelled) return;
        if (state.entitlement?.tier === "vip" && state.entitlement.status === "active") {
          router.replace("/checkout/vip/success");
          return;
        }
        if (state.subscription?.status === "cancelled" || state.subscription?.status === "error") {
          router.replace("/checkout/vip/failure");
          return;
        }
        setMessage(`Verificando el pago con Mercado Pago${".".repeat((attempts % 3) + 1)}`);
        if (attempts >= 12) {
          router.replace("/checkout/vip/pending");
          return;
        }
        window.setTimeout(() => void check(), 2500);
      } catch {
        if (attempts >= 12) router.replace("/checkout/vip/pending");
        else window.setTimeout(() => void check(), 2500);
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [router, user]);

  return <Status title="Verificando CLOUVA VIP" message={message} spinner />;
}

function Status({ title, message, spinner }: { title: string; message: string; spinner?: boolean }) {
  return <main className="flex min-h-screen items-center justify-center bg-[#05040a] px-4 text-white"><div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0b0913] p-8 text-center">{spinner ? <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-white/15 border-t-violet-400" /> : null}<h1 className="mt-5 text-2xl font-semibold">{title}</h1><p className="mt-3 leading-7 text-white/55">{message}</p></div></main>;
}
