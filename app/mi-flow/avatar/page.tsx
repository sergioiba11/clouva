"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Camera, Check, Sparkles } from "lucide-react";
import { AvatarModel } from "@/components/clouva/AvatarModel";

const categories = ["Estilo", "Pelo", "Parte superior", "Pantalón", "Zapatillas", "Accesorios", "Colores"];
const options: Record<string, string[]> = {
  Estilo: ["Nocturno", "Street", "Minimal"],
  Pelo: ["Corto", "Ondas", "Capucha"],
  "Parte superior": ["Bomber", "Hoodie", "Top"],
  Pantalón: ["Cargo", "Wide", "Jogger"],
  Zapatillas: ["Glow", "Classic", "Runner"],
  Accesorios: ["Lentes", "Collar", "Aros"],
  Colores: ["Violeta", "Negro", "Hielo"],
};

export default function AvatarPage() {
  const [active, setActive] = useState(categories[0]);
  const [selected, setSelected] = useState<Record<string, string>>({ Estilo: "Nocturno", Colores: "Violeta" });
  const [photo, setPhoto] = useState<string | null>(null);
  const activeOptions = useMemo(() => options[active] ?? [], [active]);

  return (
    <main className="avatar-creator" aria-label="Creador inmersivo de avatar CLOUVA">
      <div className="avatar-creator-aura" aria-hidden="true" />
      <Link href="/" className="avatar-back"><ArrowLeft className="h-4 w-4" /> Volver</Link>

      <section className="avatar-creator-stage" onPointerDown={(event) => event.stopPropagation()}>
        <AvatarModel className="avatar-creator-model" />
      </section>

      <aside className="avatar-photo-card">
        <label className="avatar-photo-button">
          <Camera className="h-4 w-4" /> Crear desde foto
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setPhoto(URL.createObjectURL(file));
            }}
          />
        </label>
        {photo ? <img src={photo} alt="Preview de foto para crear avatar" className="avatar-photo-preview" /> : null}
        {photo ? <button type="button" className="avatar-photo-continue"><Check className="h-3.5 w-3.5" /> Continuar</button> : null}
      </aside>

      <section className="avatar-editor" aria-label="Opciones de personalización">
        <div className="avatar-category-tray">
          {categories.map((category) => (
            <button key={category} type="button" onClick={() => setActive(category)} className={category === active ? "active" : ""}>{category}</button>
          ))}
        </div>
        <div className="avatar-option-grid">
          {activeOptions.map((option) => (
            <button key={option} type="button" onClick={() => setSelected((value) => ({ ...value, [active]: option }))} className={selected[active] === option ? "active" : ""}>
              <span className="avatar-option-orb"><Sparkles className="h-4 w-4" /></span>
              {option}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
