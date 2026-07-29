"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MainFooter, MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { slugify } from "@/lib/store-utils";

export default function NuevoEstudioPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [isVip, setIsVip] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      if (!user) {
        setIsVip(false);
        return;
      }
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("user_entitlements")
        .select("tier,status,expires_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .in("tier", ["player", "vip"]);
      const hasActiveEntitlement = (data ?? []).some(
        (row) => !row.expires_at || new Date(row.expires_at) > new Date(),
      );
      setIsVip(hasActiveEntitlement);
    })();
  }, [user]);

  const create = async () => {
    if (!user || !name.trim()) return;
    setSaving(true);
    setError("");
    const { supabase } = await import("@/lib/supabase");

    let slug = slugify(name);
    let attempt = 0;
    // Uniqueness check/suffix before insert -- no DB trigger for this, computed client-side.
    while (attempt < 5) {
      const { data: existing } = await supabase.from("studios").select("id").eq("slug", slug).maybeSingle();
      if (!existing) break;
      attempt += 1;
      slug = `${slugify(name)}-${attempt + 1}`;
    }

    const { data, error: err } = await supabase
      .from("studios")
      .insert({ name: name.trim(), slug, owner_id: user.id, city: city.trim() || null, description: description.trim() || null })
      .select("slug")
      .single();
    setSaving(false);
    if (err || !data) {
      setError(err?.message ?? "No se pudo crear el estudio");
      return;
    }
    router.push(`/studios/${data.slug}`);
  };

  if (authLoading || isVip === null) {
    return (
      <main>
        <MainNav />
        <section className="mx-auto max-w-2xl px-4 py-16">
          <p className="text-white/60">Cargando...</p>
        </section>
        <MainFooter />
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <MainNav />
        <section className="mx-auto max-w-2xl px-4 py-16">
          <p className="text-white/60">Necesitás iniciar sesión para crear un estudio.</p>
        </section>
        <MainFooter />
      </main>
    );
  }

  if (!isVip) {
    return (
      <main>
        <MainNav />
        <section className="mx-auto max-w-2xl px-4 py-16">
          <div className="panel rounded-3xl p-6">
            <h1 className="text-2xl font-semibold">Crear estudio</h1>
            <p className="mt-3 text-sm text-white/60">
              Crear un estudio es una función exclusiva para usuarios con plan Player/VIP de CLOUVA por ahora.
            </p>
          </div>
        </section>
        <MainFooter />
      </main>
    );
  }

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-2xl px-4 py-16">
        <div className="panel rounded-3xl p-6">
          <h1 className="text-2xl font-semibold">Crear estudio</h1>
          {error ? <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
          <div className="mt-4 space-y-3">
            <input
              placeholder="Nombre del estudio"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm"
            />
            <input
              placeholder="Ciudad"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm"
            />
            <textarea
              placeholder="Descripción"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm"
              rows={4}
            />
            <button
              onClick={create}
              disabled={saving || !name.trim()}
              className="rounded-full bg-[#8f7cff] px-5 py-2.5 text-sm font-medium text-black disabled:opacity-50"
            >
              {saving ? "Creando..." : "Crear estudio"}
            </button>
          </div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
