"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Material, Mesh, Object3D } from "three";
import { CanvasTexture, Color, MeshStandardMaterial, SRGBColorSpace } from "three";
import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";
import { useAuth } from "@/components/auth-provider";

type SlotDef = { key: string; label: string; icon: string; meshNames: string[] };

const SLOTS: SlotDef[] = [
  { key: "body", label: "Cuerpo", icon: "🧍", meshNames: ["Casual_Head"] },
  { key: "hair", label: "Cabello", icon: "💇", meshNames: ["Casual_Head"] },
  { key: "top", label: "Top", icon: "👕", meshNames: ["Casual_Body"] },
  { key: "bottom", label: "Bottom", icon: "👖", meshNames: ["Casual_Legs"] },
  { key: "shoes", label: "Zapatos", icon: "👟", meshNames: ["Casual_Feet"] },
  { key: "accessories", label: "Accesorios", icon: "🔗", meshNames: [] },
];

const SWATCHES = ["#0a0a0a", "#ffffff", "#c0392b", "#2d6cdf", "#2e8b57", "#8f7cff"];
const MATERIAL_PRESETS: Record<string, { roughness: number; metalness: number }> = {
  Mate: { roughness: 0.9, metalness: 0.02 },
  Brillante: { roughness: 0.15, metalness: 0.15 },
  Tela: { roughness: 0.75, metalness: 0 },
};

type DiscoveredMaterial = { name: string; material: MeshStandardMaterial };

export default function AvatarCustomizerPage() {
  const { user } = useAuth();
  const activeAvatar = useActiveAvatarStore((state) => state.avatar);
  const [selectedSlot, setSelectedSlot] = useState(SLOTS[2].key);
  const [materialsByMesh, setMaterialsByMesh] = useState<Record<string, DiscoveredMaterial[]>>({});
  const [selectedMaterialName, setSelectedMaterialName] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [preset, setPreset] = useState<Record<string, string>>({});
  const [decalPos, setDecalPos] = useState({ x: 0, y: 0, size: 100 });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const modelRef = useRef<Object3D | null>(null);
  const meshRef = useRef<Record<string, Mesh>>({});

  const slot = SLOTS.find((s) => s.key === selectedSlot)!;

  const slotMaterials = useMemo(() => {
    const seen = new Map<string, DiscoveredMaterial>();
    for (const meshName of slot.meshNames) {
      for (const m of materialsByMesh[meshName] ?? []) seen.set(m.name, m);
    }
    return Array.from(seen.values());
  }, [slot, materialsByMesh]);

  const activeMaterial = slotMaterials.find((m) => m.name === selectedMaterialName) ?? slotMaterials[0] ?? null;

  const onReady = (object: Object3D) => {
    modelRef.current = object;
    const byMesh: Record<string, DiscoveredMaterial[]> = {};
    const meshes: Record<string, Mesh> = {};
    object.traverse((child: any) => {
      if (!child.isMesh) return;
      meshes[child.name] = child;
      const mats: Material[] = Array.isArray(child.material) ? child.material : [child.material];
      byMesh[child.name] = mats
        .filter((m): m is MeshStandardMaterial => !!m && (m as MeshStandardMaterial).isMeshStandardMaterial !== false)
        .map((m) => ({ name: m.name || "Material", material: m as MeshStandardMaterial }));
    });
    meshRef.current = meshes;
    setMaterialsByMesh(byMesh);
    setVisible(Object.fromEntries(Object.keys(meshes).map((n) => [n, meshes[n].visible])));
  };

  const setColor = (hex: string) => {
    if (!activeMaterial) return;
    activeMaterial.material.color = new Color(hex);
    activeMaterial.material.needsUpdate = true;
    setPreset((p) => ({ ...p, __force: String(Date.now()) }));
  };

  const setMaterialPreset = (name: string) => {
    if (!activeMaterial) return;
    const p = MATERIAL_PRESETS[name];
    activeMaterial.material.roughness = p.roughness;
    activeMaterial.material.metalness = p.metalness;
    activeMaterial.material.needsUpdate = true;
    setPreset((prev) => ({ ...prev, [activeMaterial.name]: name }));
  };

  const toggleMeshVisible = () => {
    for (const meshName of slot.meshNames) {
      const mesh = meshRef.current[meshName];
      if (mesh) mesh.visible = !mesh.visible;
    }
    setVisible((v) => ({ ...v, ...Object.fromEntries(slot.meshNames.map((n) => [n, meshRef.current[n]?.visible ?? true])) }));
  };

  const drawDecal = (img: HTMLImageElement, pos: { x: number; y: number; size: number }) => {
    if (!activeMaterial) return;
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = `#${activeMaterial.material.color.getHexString()}`;
    ctx.fillRect(0, 0, size, size);
    const scale = pos.size / 100;
    const w = size * scale * 0.6;
    const h = w * (img.height / img.width);
    const cx = size / 2 + (pos.x / 100) * (size / 2);
    const cy = size / 2 - (pos.y / 100) * (size / 2);
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    activeMaterial.material.map = texture;
    activeMaterial.material.needsUpdate = true;
  };

  const lastImageRef = useRef<HTMLImageElement | null>(null);

  const onUploadEstampa = (file: File) => {
    const img = new Image();
    img.onload = () => {
      lastImageRef.current = img;
      drawDecal(img, decalPos);
    };
    img.src = URL.createObjectURL(file);
  };

  const onDecalPosChange = (next: typeof decalPos) => {
    setDecalPos(next);
    if (lastImageRef.current) drawDecal(lastImageRef.current, next);
  };

  const resetDesign = () => {
    if (!activeMaterial) return;
    activeMaterial.material.map = null;
    activeMaterial.material.needsUpdate = true;
    setDecalPos({ x: 0, y: 0, size: 100 });
  };

  const saveDesign = async () => {
    if (!user || !activeAvatar.id) return;
    setSaveState("saving");
    try {
      const customization: Record<string, any> = {};
      for (const meshMats of Object.values(materialsByMesh)) {
        for (const m of meshMats) {
          customization[m.name] = {
            color: `#${m.material.color.getHexString()}`,
            roughness: m.material.roughness,
            metalness: m.material.metalness,
          };
        }
      }
      const { supabase } = await import("@/lib/supabase");
      const { error } = await supabase.from("user_avatars").update({ customization }).eq("id", activeAvatar.id).eq("user_id", user.id);
      if (error) throw error;
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] pb-10 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <Link href="/mi-flow/avatar" className="text-sm text-white/60">← Volver</Link>
        <p className="text-xs uppercase tracking-[0.25em] text-white/40">Avatar Customizer</p>
      </div>

      <div className="grid gap-3 p-3 lg:grid-cols-[200px_1fr_320px]">
        {/* Sidebar de slots */}
        <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {SLOTS.map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setSelectedSlot(s.key);
                setSelectedMaterialName(null);
              }}
              className={`flex flex-shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm lg:w-full ${
                selectedSlot === s.key ? "border-[#8f7cff] bg-[#8f7cff]/15" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <span>{s.icon}</span> {s.label}
            </button>
          ))}
        </div>

        {/* Visor 3D */}
        <div className="relative min-h-[420px] overflow-hidden rounded-2xl border border-white/10 bg-black/40 lg:min-h-[560px]">
          <AvatarModelViewer
            modelUrl={activeAvatar.modelUrl}
            fallbackModelUrl={activeAvatar.fallbackUrl}
            frontRotationY={activeAvatar.frontRotationY}
            onReady={onReady}
          />
        </div>

        {/* Panel de edición del slot */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-white/70">{slot.label}</h2>
            {slot.meshNames.length > 0 ? (
              <button onClick={toggleMeshVisible} className="text-xs text-white/50 underline">
                {slot.meshNames.every((n) => visible[n] === false) ? "Mostrar" : "Ocultar"}
              </button>
            ) : null}
          </div>

          {slot.meshNames.length === 0 ? (
            <p className="text-sm text-white/40">Todavía no hay accesorios cargados para este avatar.</p>
          ) : slotMaterials.length === 0 ? (
            <p className="text-sm text-white/40">Cargando materiales…</p>
          ) : (
            <>
              {slotMaterials.length > 1 ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {slotMaterials.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => setSelectedMaterialName(m.name)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        activeMaterial?.name === m.name ? "border-[#8f7cff] bg-[#8f7cff]/20" : "border-white/10 text-white/50"
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              ) : null}

              <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Color ({activeMaterial?.name})</p>
              <div className="mb-4 flex flex-wrap gap-2">
                {SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    onClick={() => setColor(hex)}
                    className="h-8 w-8 rounded-full border border-white/20"
                    style={{ background: hex }}
                  />
                ))}
                <input
                  type="color"
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-8 rounded-full border border-white/20 bg-transparent"
                />
              </div>

              <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Material</p>
              <div className="mb-4 flex gap-2">
                {Object.keys(MATERIAL_PRESETS).map((name) => (
                  <button
                    key={name}
                    onClick={() => setMaterialPreset(name)}
                    className={`rounded-full border px-3 py-1.5 text-xs ${
                      preset[activeMaterial?.name ?? ""] === name ? "border-[#8f7cff] bg-[#8f7cff]/20" : "border-white/10 text-white/60"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Estampa</p>
              <label className="mb-3 block cursor-pointer rounded-xl border border-dashed border-white/20 px-3 py-2 text-center text-xs text-white/50">
                Subir imagen
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUploadEstampa(e.target.files[0])} />
              </label>

              <div className="mb-1 flex items-center justify-between text-xs text-white/40">
                <span>Tamaño</span>
                <span>{decalPos.size}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={200}
                value={decalPos.size}
                onChange={(e) => onDecalPosChange({ ...decalPos, size: Number(e.target.value) })}
                className="mb-3 w-full"
              />
              <div className="mb-1 flex items-center justify-between text-xs text-white/40">
                <span>Posición X</span>
                <span>{decalPos.x}%</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={decalPos.x}
                onChange={(e) => onDecalPosChange({ ...decalPos, x: Number(e.target.value) })}
                className="mb-3 w-full"
              />
              <div className="mb-1 flex items-center justify-between text-xs text-white/40">
                <span>Posición Y</span>
                <span>{decalPos.y}%</span>
              </div>
              <input
                type="range"
                min={-100}
                max={100}
                value={decalPos.y}
                onChange={(e) => onDecalPosChange({ ...decalPos, y: Number(e.target.value) })}
                className="mb-4 w-full"
              />

              <div className="flex gap-2">
                <button onClick={resetDesign} className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-white/60">
                  Restablecer
                </button>
                <button onClick={saveDesign} className="flex-1 rounded-xl bg-[#8f7cff] py-2.5 text-sm font-medium text-black">
                  {saveState === "saving" ? "Guardando…" : saveState === "saved" ? "Guardado ✓" : "Guardar diseño"}
                </button>
              </div>
              {saveState === "error" ? <p className="mt-2 text-xs text-rose-400">No se pudo guardar.</p> : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
