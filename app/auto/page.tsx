"use client";

import { Car, ChevronRight, Gauge, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MainNav } from "@/components/layout";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Vehicle = {
  id: string;
  nickname: string | null;
  make: string;
  model: string;
  version: string | null;
  year: number | null;
  license_plate: string | null;
  odometer_km: number;
  color_current: string | null;
  overall_status: string;
};

export default function AutoPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await authenticatedFetch("/api/auto");
      const payload = await readApiJson<{ vehicles: Vehicle[] }>(response);
      setVehicles(payload.vehicles ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar tus autos.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/auto");
      return;
    }
    void load();
  }, [authLoading, load, router, user]);

  async function createVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await authenticatedFetch("/api/auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: form.get("nickname"),
          make: form.get("make"),
          model: form.get("model"),
          version: form.get("version"),
          year: form.get("year"),
          licensePlate: form.get("licensePlate"),
          odometerKm: form.get("odometerKm"),
          fuelType: form.get("fuelType"),
          transmission: form.get("transmission"),
          colorCurrent: form.get("colorCurrent"),
        }),
      });
      const payload = await readApiJson<{ vehicle: Vehicle }>(response);
      router.push(`/auto/${payload.vehicle.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el vehículo.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#05040a] pb-24 text-white">
      <MainNav />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
        <section className="relative overflow-hidden rounded-[30px] border border-violet-300/15 bg-[radial-gradient(circle_at_80%_0%,rgba(143,92,255,.22),transparent_38%),#0b0912] p-6 sm:p-9">
          <div className="relative flex items-end justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/[0.06] px-3 py-1 text-[10px] font-semibold uppercase tracking-[.17em] text-violet-200"><Car size={13} /> Player · CLOUVA Auto</div>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">MI GARAGE</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/48">Tu auto real y su gemelo digital. Revisalo, aprendé cada sistema y registrá cada arreglo.</p>
            </div>
            <button type="button" onClick={() => setShowCreate(true)} className="hidden items-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold sm:inline-flex"><Plus size={16} /> Agregar auto</button>
          </div>
        </section>

        {error ? <p className="mt-5 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] p-4 text-sm text-rose-200">{error}</p> : null}
        {loading ? <div className="mt-6 grid min-h-48 place-items-center"><Loader2 className="animate-spin text-white/35" /></div> : null}

        {!loading && !vehicles.length ? (
          <section className="mt-6 rounded-[28px] border border-white/[0.08] bg-[#0b0912] p-7 text-center sm:p-12">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl border border-violet-300/15 bg-violet-300/[0.06] text-violet-300"><Car size={30} /></div>
            <h2 className="mt-5 text-2xl font-semibold">Agregá tu primer auto</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-white/42">CLOUVA empieza con la identidad del vehículo y después lo vas completando con estados, fotos, reparaciones y su representación 3D.</p>
            <button type="button" onClick={() => setShowCreate(true)} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold"><Plus size={16} /> Crear gemelo digital</button>
          </section>
        ) : null}

        {!loading && vehicles.length ? (
          <section className="mt-6 grid gap-4 md:grid-cols-2">
            {vehicles.map((vehicle) => (
              <Link key={vehicle.id} href={`/auto/${vehicle.id}`} className="group rounded-[26px] border border-white/[0.08] bg-[#0b0912] p-5 transition hover:border-violet-300/25">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-violet-300"><Car size={25} /></span>
                  <ChevronRight className="text-white/20 transition group-hover:translate-x-1 group-hover:text-violet-300" />
                </div>
                <h2 className="mt-5 text-2xl font-semibold">{vehicle.nickname || `${vehicle.make} ${vehicle.model}`}</h2>
                <p className="mt-1 text-sm text-white/45">{vehicle.make} {vehicle.model}{vehicle.version ? ` · ${vehicle.version}` : ""}{vehicle.year ? ` · ${vehicle.year}` : ""}</p>
                <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4 text-xs text-white/38"><span className="inline-flex items-center gap-1.5"><Gauge size={13} /> {Number(vehicle.odometer_km || 0).toLocaleString("es-AR")} km</span><span>{vehicle.license_plate || "Sin patente cargada"}</span></div>
              </Link>
            ))}
          </section>
        ) : null}
      </div>

      <button type="button" onClick={() => setShowCreate(true)} className="fixed bottom-6 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-violet-500 shadow-2xl sm:hidden"><Plus /></button>

      {showCreate ? (
        <div className="fixed inset-0 z-[100] grid items-end bg-black/70 backdrop-blur-sm sm:items-center sm:p-6">
          <form onSubmit={createVehicle} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] border border-white/10 bg-[#0b0912] p-5 sm:mx-auto sm:max-w-2xl sm:rounded-[30px] sm:p-7">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.17em] text-violet-300">Nuevo gemelo digital</p><h2 className="mt-1 text-2xl font-semibold">¿Qué auto es?</h2></div><button type="button" onClick={() => setShowCreate(false)} className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.05]"><X size={18} /></button></div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <input name="nickname" placeholder="Nombre (opcional)" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <input name="make" required placeholder="Marca *" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <input name="model" required placeholder="Modelo *" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <input name="version" placeholder="Versión / motor" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <input name="year" inputMode="numeric" placeholder="Año" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <input name="licensePlate" placeholder="Patente" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <input name="odometerKm" inputMode="numeric" placeholder="Kilometraje" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <input name="colorCurrent" placeholder="Color actual" className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 outline-none focus:border-violet-400/50" />
              <select name="fuelType" defaultValue="" className="rounded-2xl border border-white/10 bg-[#12101a] px-4 py-3"><option value="">Combustible</option><option>Nafta</option><option>Diésel</option><option>GNC</option><option>Híbrido</option><option>Eléctrico</option></select>
              <select name="transmission" defaultValue="" className="rounded-2xl border border-white/10 bg-[#12101a] px-4 py-3"><option value="">Transmisión</option><option>Manual</option><option>Automática</option><option>CVT</option></select>
            </div>
            <button disabled={creating} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 py-3.5 font-semibold disabled:opacity-50">{creating ? <Loader2 size={17} className="animate-spin" /> : <Car size={17} />} Crear y abrir mi auto</button>
          </form>
        </div>
      ) : null}
    </main>
  );
}
