"use client";

import { useState } from "react";

export default function OfficialAvatarAdminPage() {
  const [secret, setSecret] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("Elegí el GLB base de CLOUVA.");
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) {
      setStatus("Primero elegí un archivo .glb");
      return;
    }
    setBusy(true);
    setStatus("Subiendo rig oficial…");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/avatar/official", {
        method: "POST",
        headers: { "x-clouva-admin-secret": secret },
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falló la carga");
      setModelUrl(result.modelUrl);
      setStatus(`Avatar oficial cargado · ${(result.size / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: "100dvh", background: "#050308", color: "white", padding: 24, display: "grid", placeItems: "center" }}>
      <section style={{ width: "min(520px, 100%)", padding: 24, borderRadius: 24, background: "rgba(24,12,38,.92)", border: "1px solid rgba(168,85,247,.35)" }}>
        <p style={{ color: "#c084fc", fontSize: 12, letterSpacing: ".16em", fontWeight: 800 }}>CLOUVA ADMIN</p>
        <h1 style={{ margin: "8px 0 6px", fontSize: 28 }}>Avatar oficial</h1>
        <p style={{ margin: "0 0 20px", color: "#c4b5d4", lineHeight: 1.5 }}>
          Esta carga reemplaza el modelo oficial que ven todos los usuarios en home y editor.
        </p>

        <label style={{ display: "grid", gap: 7, marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: "#d8c7e8" }}>Clave administrativa</span>
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            style={{ padding: 13, borderRadius: 12, color: "white", background: "#0d0812", border: "1px solid #3b2450" }}
          />
        </label>

        <label style={{ display: "grid", gap: 7, marginBottom: 18 }}>
          <span style={{ fontSize: 13, color: "#d8c7e8" }}>Archivo GLB</span>
          <input
            type="file"
            accept=".glb,model/gltf-binary,application/octet-stream"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            style={{ padding: 12, borderRadius: 12, background: "#0d0812", border: "1px solid #3b2450" }}
          />
        </label>

        <button
          type="button"
          disabled={busy || !file || !secret}
          onClick={() => void upload()}
          style={{ width: "100%", padding: 14, border: 0, borderRadius: 14, fontWeight: 850, color: "white", background: busy ? "#4c3b56" : "linear-gradient(135deg,#7c3aed,#a855f7)", opacity: !file || !secret ? 0.55 : 1 }}
        >
          {busy ? "Subiendo…" : "Publicar como avatar oficial"}
        </button>

        <p style={{ marginTop: 16, color: status.toLowerCase().includes("error") || status.toLowerCase().includes("missing") ? "#fca5a5" : "#d8c7e8" }}>{status}</p>
        {modelUrl ? <a href={modelUrl} target="_blank" rel="noreferrer" style={{ color: "#c084fc" }}>Abrir GLB publicado</a> : null}
      </section>
    </main>
  );
}
