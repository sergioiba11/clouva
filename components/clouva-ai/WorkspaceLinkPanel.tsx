"use client";

import { FormEvent, useEffect, useState } from "react";
import { Laptop, Link2, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Task 9's UI: "Conectar mi Workspace". Admin-only, same trust tier as
// GeminiModelSelector's neighbor "Proyecto" mode in ClouvaAIChat.tsx — the
// backing route (app/api/clouva-ai/workspace-link/route.ts) enforces that
// server-side; this component just hides itself entirely on a 403 rather
// than showing a form a non-admin can't use anyway.

type WorkspaceLink = {
  id: string;
  workspaceId: string;
  deviceId: string;
  label: string;
  permissions: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};
type LinksPayload = { links?: WorkspaceLink[]; error?: string };
type PairPayload = { link?: WorkspaceLink; error?: string };

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function WorkspaceLinkPanel() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<WorkspaceLink[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [workspaceIdInput, setWorkspaceIdInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [pairing, setPairing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Iniciá sesión en CLOUVA.");
    return token;
  }

  async function loadLinks() {
    setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch("/api/clouva-ai/workspace-link", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      if (response.status === 403) {
        // Not an admin — this feature isn't for this account at all, not
        // even a "no autorizado" message. Same silent-hide treatment
        // GeminiModelSelector's sibling "Proyecto" mode gets from regular
        // users elsewhere in this UI.
        setVisible(false);
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as LinksPayload;
      if (!response.ok) throw new Error(payload.error ?? "No se pudo consultar el Workspace.");

      setVisible(true);
      setLinks((payload.links ?? []).filter((link) => !link.revoked));
    } catch (caught) {
      // A real error (not a 403) still means an admin is looking at this —
      // show the panel so the error has somewhere to land.
      setVisible(true);
      setError(caught instanceof Error ? caught.message : "No se pudo consultar el Workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pair(event: FormEvent) {
    event.preventDefault();
    const workspaceId = workspaceIdInput.trim();
    const code = codeInput.trim();
    if (!workspaceId || !code || pairing) return;

    setPairing(true);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch("/api/clouva-ai/workspace-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, code }),
      });
      const payload = (await response.json().catch(() => ({}))) as PairPayload;
      if (!response.ok || !payload.link) throw new Error(payload.error ?? "No se pudo parear el Workspace.");

      setLinks((current) => [payload.link as WorkspaceLink, ...current.filter((l) => l.workspaceId !== workspaceId)]);
      setWorkspaceIdInput("");
      setCodeInput("");
      setShowForm(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo parear el Workspace.");
    } finally {
      setPairing(false);
    }
  }

  async function revoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    setError(null);
    try {
      const token = await getToken();
      const response = await fetch(`/api/clouva-ai/workspace-link?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo desconectar el Workspace.");
      setLinks((current) => current.filter((link) => link.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo desconectar el Workspace.");
    } finally {
      setRevokingId(null);
    }
  }

  if (!visible) return null;

  return (
    <section className="mx-auto w-full max-w-5xl shrink-0 px-4 pt-2 sm:px-6">
      <div className="rounded-2xl border border-violet-500/20 bg-zinc-950/95 p-3 shadow-lg shadow-violet-950/20">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-xl bg-violet-500/15 p-2 text-violet-300">
            <Laptop className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-300">Workspace</p>
            <p className="truncate text-xs text-white/50">
              {loading
                ? "Consultando…"
                : links.length
                  ? `${links.length} conectado${links.length > 1 ? "s" : ""}`
                  : "Ninguna PC conectada todavía"}
            </p>
          </div>
          {!loading && (
            <button
              type="button"
              onClick={() => setShowForm((current) => !current)}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:border-violet-400/50 hover:text-white"
            >
              {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              {showForm ? "Cancelar" : "Conectar Workspace"}
            </button>
          )}
        </div>

        {loading ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-white/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
          </p>
        ) : (
          <>
            {links.length > 0 && (
              <div className="mt-3 space-y-2">
                {links.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {link.label} — pareado {formatDate(link.createdAt)}
                      {link.lastUsedAt ? ` · usado ${formatDate(link.lastUsedAt)}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => void revoke(link.id)}
                      disabled={revokingId === link.id}
                      className="shrink-0 rounded-full border border-current/20 p-1.5 transition hover:bg-black/20 disabled:opacity-40"
                      aria-label="Desconectar este Workspace"
                    >
                      {revokingId === link.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showForm && (
              <form onSubmit={pair} className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
                <p className="text-[11px] text-white/40">
                  En Workspace: Devices → "Pair new device" → ingresá acá el <code>workspaceId</code> y el código que
                  te muestra, tal como aparecen ahí (pareo manual, fuera de la LAN).
                </p>
                <input
                  value={workspaceIdInput}
                  onChange={(event) => setWorkspaceIdInput(event.target.value)}
                  placeholder="workspaceId"
                  disabled={pairing}
                  className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 font-mono text-xs text-white outline-none focus:border-violet-400/60 disabled:opacity-50"
                />
                <input
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value)}
                  placeholder="Código de pareo"
                  disabled={pairing}
                  className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 font-mono text-xs uppercase tracking-widest text-white outline-none focus:border-violet-400/60 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={pairing || !workspaceIdInput.trim() || !codeInput.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium transition hover:bg-violet-500 disabled:opacity-40"
                >
                  {pairing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  {pairing ? "Pareando…" : "Conectar"}
                </button>
              </form>
            )}
          </>
        )}

        {error && (
          <p className="mt-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
        )}
      </div>
    </section>
  );
}
