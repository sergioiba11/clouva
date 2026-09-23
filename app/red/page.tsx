"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Network,
  RefreshCw,
  ScanLine,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin } from "@/lib/auth";
import {
  ClouvaNetwork3D,
  type ClouvaNetworkSnapshot,
  type PublicNetworkAsset,
} from "@/components/security/ClouvaNetwork3D";

type ApiPayload = {
  ok?: boolean;
  result?: ClouvaNetworkSnapshot;
  error?: string;
};

type SecurityPayload = {
  ok?: boolean;
  assets?: PublicNetworkAsset[];
  checkedAt?: string;
  error?: string;
};

function serviceFromActivity(title?: string | null, process?: string | null) {
  const text = (title ?? "").toLowerCase();
  if (text.includes("youtube")) return "YouTube";
  if (text.includes("chatgpt")) return "ChatGPT";
  if (text.includes("discord")) return "Discord";
  if (text.includes("github")) return "GitHub";
  if (text.includes("cloudflare")) return "Cloudflare";
  if (text.includes("clouva")) return "CLOUVA";
  return process || "sin actividad identificada";
}

export default function NetworkMapPage() {
  const { user, session, role, loading, hydrationReady, profileReady } = useAuth();
  const router = useRouter();
  const isAdmin = canAccessAdmin(role);

  const [snapshot, setSnapshot] = useState<ClouvaNetworkSnapshot | null>(null);
  const [assets, setAssets] = useState<PublicNetworkAsset[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastPublicCheck, setLastPublicCheck] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !hydrationReady || !profileReady) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!isAdmin) router.replace("/");
  }, [hydrationReady, isAdmin, loading, profileReady, router, user]);

  const callNetwork = useCallback(
    async (action: "snapshot" | "discover") => {
      if (!session?.access_token) throw new Error("Sesión requerida.");
      const response = await fetch("/api/network/scan", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok) throw new Error(payload.error || "No se pudo leer Workspace.");
      return payload.result ?? null;
    },
    [session?.access_token],
  );

  const readPublicWorld = useCallback(async () => {
    if (!session?.access_token) throw new Error("Sesión requerida.");
    const response = await fetch("/api/security/overview", {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const payload = (await response.json().catch(() => ({}))) as SecurityPayload;
    if (!response.ok) throw new Error(payload.error || "No se pudo leer la superficie pública.");
    setAssets(Array.isArray(payload.assets) ? payload.assets : []);
    setLastPublicCheck(payload.checkedAt ?? new Date().toISOString());
    setSecurityError(null);
  }, [session?.access_token]);

  const refreshWorkspace = useCallback(
    async (action: "snapshot" | "discover" = "snapshot") => {
      setBusy(action);
      try {
        const result = await callNetwork(action);
        if (result) {
          setSnapshot((current) => ({
            ...(current ?? {}),
            ...result,
            devices: result.devices?.length ? result.devices : current?.devices ?? [],
          }));
        }
        setWorkspaceError(null);
      } catch (cause) {
        setWorkspaceError(
          cause instanceof Error ? cause.message : "Workspace no está enviando telemetría.",
        );
      } finally {
        setBusy(null);
      }
    },
    [callNetwork],
  );

  useEffect(() => {
    if (!isAdmin || !session?.access_token) return;

    void refreshWorkspace("discover");
    void readPublicWorld().catch((cause) => {
      setSecurityError(
        cause instanceof Error ? cause.message : "No se pudo leer la superficie pública.",
      );
    });

    const workspaceTimer = window.setInterval(() => {
      void refreshWorkspace("snapshot");
    }, 5_000);

    const publicTimer = window.setInterval(() => {
      void readPublicWorld().catch((cause) => {
        setSecurityError(
          cause instanceof Error ? cause.message : "No se pudo leer la superficie pública.",
        );
      });
    }, 10_000);

    return () => {
      window.clearInterval(workspaceTimer);
      window.clearInterval(publicTimer);
    };
  }, [isAdmin, readPublicWorld, refreshWorkspace, session?.access_token]);

  const liveConnections = snapshot?.connections?.length ?? 0;
  const liveDevices = snapshot?.devices?.length ?? 0;
  const liveAssets = useMemo(
    () => assets.filter((asset) => asset.reachable).length,
    [assets],
  );

  if (loading || !hydrationReady || !profileReady || !user || !isAdmin) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#02050a] text-white">
        <div className="flex items-center gap-2 text-sm font-bold text-white/45">
          <Loader2 className="h-5 w-5 animate-spin" /> Abriendo CLOUVA Network 3D...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#02050a] text-white">
      <div className="mx-auto w-full max-w-[1800px] px-2 pb-4 pt-2 sm:px-4 sm:pt-4">
        <header className="sticky top-2 z-50 flex items-center justify-between gap-3 rounded-2xl border border-cyan-300/10 bg-[#050a10]/88 px-3 py-2.5 shadow-2xl shadow-black/35 backdrop-blur-2xl">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.03] text-white/70"
              aria-label="Volver"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>

            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-300/20 bg-violet-300/[.06] text-violet-100">
              <Network className="h-5 w-5" />
            </span>

            <div className="min-w-0">
              <div className="truncate text-sm font-black uppercase tracking-[.12em]">
                CLOUVA NETWORK 3D
              </div>
              <div className="truncate text-[9px] font-bold uppercase tracking-[.13em] text-white/32">
                Todo CLOUVA como nodos · arquitectura + telemetría viva
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href="/seguridad"
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[.03] text-white/65 sm:flex sm:w-auto sm:gap-2 sm:px-3"
              aria-label="Seguridad"
            >
              <Shield className="h-4 w-4" />
              <span className="hidden text-[10px] font-black uppercase tracking-[.08em] sm:inline">
                Seguridad
              </span>
            </Link>

            <button
              type="button"
              onClick={() => void refreshWorkspace("snapshot")}
              disabled={Boolean(busy)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[.03] text-white/65"
              aria-label="Actualizar"
            >
              <RefreshCw className={`h-4 w-4 ${busy === "snapshot" ? "animate-spin" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() => void refreshWorkspace("discover")}
              disabled={Boolean(busy)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[.06] text-cyan-100"
              aria-label="Escanear LAN"
            >
              {busy === "discover" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        <section className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <div className="rounded-xl border border-white/7 bg-white/[.018] px-3 py-2">
            <div className="text-[8px] font-black uppercase tracking-[.13em] text-white/28">
              Actividad PC
            </div>
            <div className="mt-1 truncate text-[11px] font-black text-cyan-50/85">
              {serviceFromActivity(
                snapshot?.activity?.foregroundTitle,
                snapshot?.activity?.foregroundProcess,
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/7 bg-white/[.018] px-3 py-2">
            <div className="text-[8px] font-black uppercase tracking-[.13em] text-white/28">
              Conexiones
            </div>
            <div className="mt-1 text-[11px] font-black text-emerald-100/85">
              {liveConnections} activas
            </div>
          </div>

          <div className="rounded-xl border border-white/7 bg-white/[.018] px-3 py-2">
            <div className="text-[8px] font-black uppercase tracking-[.13em] text-white/28">
              LAN
            </div>
            <div className="mt-1 text-[11px] font-black text-cyan-100/85">
              {liveDevices} nodos
            </div>
          </div>

          <div className="rounded-xl border border-white/7 bg-white/[.018] px-3 py-2">
            <div className="text-[8px] font-black uppercase tracking-[.13em] text-white/28">
              Público
            </div>
            <div className="mt-1 text-[11px] font-black text-violet-100/85">
              {liveAssets}/{assets.length || 2} vivos
            </div>
          </div>
        </section>

        {securityError ? (
          <div className="mt-2 rounded-xl border border-amber-300/15 bg-amber-300/[.04] px-3 py-2 text-[10px] text-amber-100/75">
            Superficie pública: {securityError}
          </div>
        ) : null}

        <div className="mt-2">
          <ClouvaNetwork3D
            snapshot={snapshot}
            assets={assets}
            workspaceError={workspaceError}
          />
        </div>

        <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[8px] font-semibold uppercase tracking-[.11em] text-white/20">
          <span>
            LIVE = observado · CONOCIDO = arquitectura · SIN SEÑAL = sensor sin telemetría
          </span>
          <span>
            {lastPublicCheck
              ? `Público verificado ${new Date(lastPublicCheck).toLocaleTimeString("es-AR")}`
              : "esperando superficie pública"}
          </span>
        </footer>
      </div>
    </main>
  );
}
