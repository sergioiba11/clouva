import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { performance } from "node:perf_hooks";
import { isAdminEmail, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type HeaderCheck = {
  key: string;
  label: string;
  present: boolean;
  value: string | null;
};

type PublicAsset = {
  id: string;
  label: string;
  host: string;
  kind: "web" | "game";
  ips: string[];
  dnsOk: boolean;
  reachable: boolean;
  latencyMs: number | null;
  httpStatus?: number | null;
  tls?: {
    valid: boolean;
    protocol: string | null;
    issuer: string | null;
    validTo: string | null;
    daysRemaining: number | null;
  } | null;
  headers?: HeaderCheck[];
  exposedPorts: Array<{ port: number; service: string; reachable: boolean; latencyMs: number | null }>;
  error?: string | null;
};

function requireAdmin(email: string | null | undefined) {
  if (!isAdminEmail(email)) {
    const error = new Error("Tu usuario no está autorizado para abrir Seguridad.") as Error & { status?: number };
    error.status = 403;
    throw error;
  }
}

async function resolveHost(host: string) {
  try {
    const rows = await lookup(host, { all: true });
    return Array.from(new Set(rows.map((row) => row.address)));
  } catch {
    return [];
  }
}

function probeTcp(host: string, port: number, timeoutMs = 3500): Promise<{ reachable: boolean; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const socket = net.createConnection({ host, port });

    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      const latencyMs = reachable ? Math.round((performance.now() - started) * 10) / 10 : null;
      socket.destroy();
      resolve({ reachable, latencyMs });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function probeTls(host: string, timeoutMs = 4500): Promise<PublicAsset["tls"]> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true });

    const finish = (value: PublicAsset["tls"]) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      const validTo = certificate?.valid_to ? new Date(certificate.valid_to) : null;
      const daysRemaining = validTo
        ? Math.max(0, Math.floor((validTo.getTime() - Date.now()) / 86_400_000))
        : null;
      const issuer = certificate?.issuer
        ? Object.values(certificate.issuer).filter(Boolean).join(" / ")
        : null;

      finish({
        valid: socket.authorized,
        protocol: socket.getProtocol() ?? null,
        issuer,
        validTo: validTo && Number.isFinite(validTo.getTime()) ? validTo.toISOString() : null,
        daysRemaining,
      });
    });
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
  });
}

async function probeWeb(host: string): Promise<PublicAsset> {
  const ips = await resolveHost(host);
  const tcp443 = await probeTcp(host, 443);
  const tlsInfo = tcp443.reachable ? await probeTls(host) : null;
  const started = performance.now();

  try {
    const response = await fetch(`https://${host}/`, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "CLOUVA-Security/1.0" },
    });
    const latencyMs = Math.round((performance.now() - started) * 10) / 10;
    const headers: HeaderCheck[] = [
      { key: "strict-transport-security", label: "HSTS", present: response.headers.has("strict-transport-security"), value: response.headers.get("strict-transport-security") },
      { key: "content-security-policy", label: "CSP", present: response.headers.has("content-security-policy"), value: response.headers.get("content-security-policy") },
      { key: "x-content-type-options", label: "X-Content-Type-Options", present: response.headers.has("x-content-type-options"), value: response.headers.get("x-content-type-options") },
      { key: "referrer-policy", label: "Referrer-Policy", present: response.headers.has("referrer-policy"), value: response.headers.get("referrer-policy") },
      { key: "permissions-policy", label: "Permissions-Policy", present: response.headers.has("permissions-policy"), value: response.headers.get("permissions-policy") },
    ];

    return {
      id: "clouva-web",
      label: "CLOUVA Web",
      host,
      kind: "web",
      ips,
      dnsOk: ips.length > 0,
      reachable: tcp443.reachable,
      latencyMs,
      httpStatus: response.status,
      tls: tlsInfo,
      headers,
      exposedPorts: [{ port: 443, service: "HTTPS", reachable: tcp443.reachable, latencyMs: tcp443.latencyMs }],
    };
  } catch (error) {
    return {
      id: "clouva-web",
      label: "CLOUVA Web",
      host,
      kind: "web",
      ips,
      dnsOk: ips.length > 0,
      reachable: false,
      latencyMs: null,
      httpStatus: null,
      tls: tlsInfo,
      headers: [],
      exposedPorts: [{ port: 443, service: "HTTPS", reachable: tcp443.reachable, latencyMs: tcp443.latencyMs }],
      error: error instanceof Error ? error.message : "No se pudo consultar HTTPS.",
    };
  }
}

async function probeMinecraft(host: string): Promise<PublicAsset> {
  const ips = await resolveHost(host);
  const java = await probeTcp(host, 25565);
  return {
    id: "ratcraft",
    label: "Ratcraft",
    host,
    kind: "game",
    ips,
    dnsOk: ips.length > 0,
    reachable: java.reachable,
    latencyMs: java.latencyMs,
    exposedPorts: [{ port: 25565, service: "Minecraft Java", reachable: java.reachable, latencyMs: java.latencyMs }],
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    requireAdmin(user.email);

    const [web, minecraft] = await Promise.all([
      probeWeb("clouva.com.ar"),
      probeMinecraft("mc.clouva.com.ar"),
    ]);

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      refreshMs: 10_000,
      assets: [web, minecraft],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo construir el estado de seguridad.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
