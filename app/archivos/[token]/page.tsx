import { notFound } from "next/navigation";
import { Download, File, FileArchive, HardDrive } from "lucide-react";
import { createAdminSupabase } from "@/lib/server/supabase";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function extension(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]{1,12})$/)?.[1] ?? "";
}

function validToken(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default async function SharedFilePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!validToken(token)) notFound();

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("clouva_files")
    .select("original_name,size_bytes,mime_type,created_at,is_share_enabled")
    .eq("share_token", token)
    .maybeSingle();

  if (error || !data?.is_share_enabled) notFound();

  const ext = extension(data.original_name);
  const ArchiveIcon = new Set(["zip", "rar", "7z", "tar", "gz", "bz2"]).has(ext)
    ? FileArchive
    : File;

  return (
    <main className="grid min-h-screen place-items-center bg-[#07080d] px-4 py-10 text-white">
      <div className="w-full max-w-xl">
        <div className="mb-5 flex items-center justify-center gap-2 text-violet-300">
          <HardDrive className="h-5 w-5" />
          <span className="text-xs font-black uppercase tracking-[0.2em]">CLOUVA Archivos</span>
        </div>

        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0d0e16] shadow-2xl">
          <div className="grid min-h-56 place-items-center border-b border-white/[0.07] bg-[radial-gradient(circle_at_top,rgba(139,92,246,.16),transparent_60%)] p-8">
            <span className="grid h-24 w-24 place-items-center rounded-3xl border border-violet-300/15 bg-violet-400/[0.07] text-violet-200">
              <ArchiveIcon className="h-11 w-11" />
            </span>
          </div>

          <div className="p-6 sm:p-7">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/28">Archivo compartido</p>
            <h1 className="mt-2 break-words text-xl font-semibold tracking-tight sm:text-2xl">{data.original_name}</h1>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/40">
              <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5">{formatBytes(Number(data.size_bytes))}</span>
              <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5">{ext.toUpperCase() || data.mime_type || "Archivo"}</span>
              <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5">{new Date(data.created_at).toLocaleDateString("es-AR")}</span>
            </div>

            <a
              href={`/api/archivos/${token}/download`}
              className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-bold text-white transition hover:bg-violet-400"
            >
              <Download className="h-4 w-4" />
              Descargar archivo
            </a>
            <p className="mt-3 text-center text-[10px] leading-4 text-white/24">El archivo se entrega desde el almacenamiento privado de CLOUVA mediante un enlace temporal.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
