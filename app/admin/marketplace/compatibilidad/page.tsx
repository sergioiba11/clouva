"use client";

import { useCallback, useEffect, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";
import { useAuth } from "@/components/auth-provider";

type CompatibilityStatus = {
  legacy_products: number;
  legacy_orders: number;
  linked_products: number;
  linked_orders: number;
  unresolved_issues: number;
};

type CompatibilityIssue = {
  id: string;
  legacy_entity_type: string;
  legacy_id: string;
  issue_code: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
};

export default function CommerceCompatibilityPage() {
  const { session } = useAuth();
  const [status, setStatus] = useState<CompatibilityStatus | null>(null);
  const [issues, setIssues] = useState<CompatibilityIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/commerce/legacy-migrate", {
        cache: "no-store",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: CompatibilityStatus;
        issues?: CompatibilityIssue[];
        error?: string;
      };
      if (!response.ok || !payload.status) throw new Error(payload.error || "No se pudo cargar la compatibilidad.");
      setStatus(payload.status);
      setIssues(payload.issues ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la compatibilidad.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runMigration() {
    if (!session?.access_token) return;
    setRunning(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/commerce/legacy-migrate", {
        method: "POST",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as {
        result?: {
          imported_products?: number;
          imported_variants?: number;
          imported_orders?: number;
          imported_items?: number;
          skipped_orders?: number;
        };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "No se pudo ejecutar el adaptador.");
      const result = payload.result ?? {};
      setMessage(
        `Importación completada: ${result.imported_products ?? 0} productos, ${result.imported_variants ?? 0} variantes, ${result.imported_orders ?? 0} pedidos y ${result.imported_items ?? 0} items.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo ejecutar el adaptador.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-2xl font-bold">Compatibilidad de tienda clásica</h1>
        <p className="mt-2 text-sm text-white/50">
          Vincula datos históricos de `products/orders` con `commerce_*` sin borrar ni modificar los registros originales.
        </p>
        <button
          type="button"
          disabled={running || loading}
          onClick={() => void runMigration()}
          className="mt-5 rounded-full bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"
        >
          {running ? "Ejecutando…" : "Buscar y vincular datos clásicos"}
        </button>
      </PremiumCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Productos clásicos" value={loading ? "…" : status?.legacy_products ?? 0} />
        <StatCard label="Productos vinculados" value={loading ? "…" : status?.linked_products ?? 0} />
        <StatCard label="Pedidos clásicos" value={loading ? "…" : status?.legacy_orders ?? 0} />
        <StatCard label="Pedidos vinculados" value={loading ? "…" : status?.linked_orders ?? 0} />
        <StatCard label="Revisión manual" value={loading ? "…" : status?.unresolved_issues ?? 0} />
      </div>

      {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">{message}</p> : null}
      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-200">{error}</p> : null}

      <PremiumCard className="p-5">
        <h2 className="text-lg font-semibold">Registros que requieren decisión</h2>
        <p className="mt-1 text-sm text-white/45">
          El adaptador no inventa compradores ni productos. Todo dato que no puede resolverse de forma segura queda listado acá.
        </p>
        <div className="mt-4 space-y-2">
          {!loading && !issues.length ? <p className="text-sm text-white/45">No hay incompatibilidades pendientes.</p> : null}
          {issues.map((issue) => (
            <div key={issue.id} className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium">{issue.legacy_entity_type} · {issue.legacy_id.slice(0, 8)}</span>
                <span className="rounded-full border border-amber-400/20 px-3 py-1 text-xs text-amber-200">{issue.issue_code}</span>
              </div>
              {issue.detail ? <p className="mt-2 text-white/55">{issue.detail}</p> : null}
              <p className="mt-2 text-xs text-white/30">Última detección: {new Date(issue.last_seen_at).toLocaleString("es-AR")}</p>
            </div>
          ))}
        </div>
      </PremiumCard>
    </div>
  );
}
