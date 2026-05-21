export default function Page() {
  return (
    <div className="panel rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(91,125,255,0.25),transparent_55%),#0b0d14] p-6">
      <h1 className="text-2xl font-bold">Admin CLOUVA</h1>
      <p className="mt-2 text-white/70 light:text-black/70">Dashboard premium conectado para gestionar catálogo, pedidos, clientes, stock y drops en tiempo real.</p>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        {[
          { label: "Ventas día", value: "$0" },
          { label: "Pedidos activos", value: "0" },
          { label: "Usuarios", value: "0" }
        ].map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm text-white/60">{metric.label}</p>
            <p className="mt-1 text-2xl font-semibold text-[#b8ccff]">{metric.value}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
