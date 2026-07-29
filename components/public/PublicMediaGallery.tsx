import type { PlayerMedia } from "@/lib/players-data";

export function PublicMediaGallery({ media }: { media: PlayerMedia[] }) {
  if (media.length === 0) return null;

  return (
    <section id="galeria" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Selección</p>
          <h2 className="mt-1 text-2xl font-semibold">Galería</h2>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {media.map((item, index) => {
          const image = item.public_url || item.thumbnail_url;
          return (
            <a
              key={item.id}
              href={item.source_url || image || "#"}
              target={item.source_url ? "_blank" : undefined}
              rel={item.source_url ? "noreferrer" : undefined}
              className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] ${index === 0 ? "col-span-2 row-span-2" : ""}`}
            >
              <div className={index === 0 ? "aspect-square" : "aspect-[4/5]"}>
                {image ? <img src={image} alt={item.caption || "Contenido"} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : null}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10">
                {item.media_type === "video" ? <span className="mb-1 inline-flex rounded-full bg-black/50 px-2 py-1 text-[10px] uppercase tracking-wider">Video</span> : null}
                {item.caption ? <p className="line-clamp-2 text-xs text-white/75">{item.caption}</p> : null}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
