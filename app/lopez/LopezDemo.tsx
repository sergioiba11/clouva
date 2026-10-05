"use client";

import {
  Activity, Bell, CheckCircle2, ChevronRight, CircleUserRound, Clock3,
  FileCheck2, FileText, HeartPulse, Home, LockKeyhole, MapPin, Pill,
  Plus, ReceiptText, Search, ShieldCheck, Stethoscope, Users, X
} from "lucide-react";
import { useMemo, useState } from "react";

type Section = "resumen" | "tramites" | "recetas" | "prestadores" | "documentos" | "seguridad";

const nav = [
  { id: "resumen" as const, label: "Inicio", icon: Home },
  { id: "tramites" as const, label: "Trámites", icon: ReceiptText },
  { id: "recetas" as const, label: "Recetas", icon: Pill },
  { id: "prestadores" as const, label: "Prestadores", icon: Stethoscope },
  { id: "documentos" as const, label: "Documentos", icon: FileText },
  { id: "seguridad" as const, label: "Seguridad", icon: ShieldCheck },
];

const procedures = [
  { title: "Autorización de estudio", detail: "Ecografía abdominal", status: "En revisión", date: "Hoy · 14:20", green: false },
  { title: "Reintegro", detail: "Consulta médica", status: "Documentación validada", date: "02 oct", green: true },
  { title: "Medicamento crónico", detail: "Renovación trimestral", status: "Aprobado", date: "30 sep", green: true },
];

function Status({ green = false, children }: { green?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold whitespace-nowrap ${green ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
      {children}
    </span>
  );
}

export function LopezDemo() {
  const [active, setActive] = useState<Section>("resumen");
  const [toast, setToast] = useState("");
  const [credential, setCredential] = useState(false);
  const [search, setSearch] = useState("");
  const title = useMemo(() => nav.find((item) => item.id === active)?.label ?? "Inicio", [active]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-[#14233a]">
      <header className="sticky top-0 z-40 flex h-[70px] items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-8">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#174b70] to-[#2388a5] text-xl font-black text-white shadow-lg shadow-sky-900/10">L</div>
          <div>
            <b className="block text-sm tracking-[.12em]">LÓPEZ</b>
            <span className="hidden text-[11px] text-slate-500 sm:block">Prototipo de experiencia · datos ficticios</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-extrabold tracking-wider text-emerald-700 sm:inline">DEMO SEGURA</span>
          <button onClick={() => flash("No hay alertas críticas.")} className="relative grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600">
            <Bell size={18}/><i className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-rose-500"/>
          </button>
          <button onClick={() => flash("Perfil demo de López.")} className="grid h-10 w-10 place-items-center rounded-full bg-[#173b5b] text-sm font-black text-white">L</button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="sticky top-[70px] hidden h-[calc(100vh-70px)] border-r border-slate-200 bg-white/40 p-4 lg:block">
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><CircleUserRound size={25}/></div>
            <div><b className="block text-xs">López</b><span className="text-[10px] text-slate-500">Afiliado · Fuerzas Armadas</span></div>
          </div>
          <nav className="grid gap-1.5">
            {nav.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setActive(id)}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-bold transition ${active === id ? "bg-sky-50 text-sky-800" : "text-slate-500 hover:bg-slate-100"}`}>
                <Icon size={18}/>{label}
              </button>
            ))}
          </nav>
          <div className="absolute bottom-5 left-4 right-4 flex gap-2 rounded-2xl bg-emerald-50 p-3 text-emerald-700">
            <ShieldCheck size={18}/><div><b className="block text-[11px]">Sesión protegida</b><span className="text-[9px] text-emerald-700/70">Último acceso: hoy 20:44</span></div>
          </div>
        </aside>

        <section className="min-w-0 p-3 sm:p-5 md:p-8">
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {nav.map(({ id, label }) => (
              <button key={id} onClick={() => setActive(id)}
                className={`whitespace-nowrap rounded-full px-3 py-2 text-[10px] font-bold ${active === id ? "bg-[#173f5c] text-white" : "bg-white text-slate-600"}`}>{label}</button>
            ))}
          </div>

          <div className="mb-5 flex items-center justify-between gap-4">
            <div><p className="mb-1 text-[10px] font-extrabold tracking-[.12em] text-slate-500">CENTRO PERSONAL</p><h1 className="text-2xl font-black tracking-tight">{title}</h1></div>
            <label className="hidden h-11 w-[360px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500 md:flex">
              <Search size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar trámite, receta o prestador" className="min-w-0 flex-1 bg-transparent text-xs outline-none"/>
            </label>
          </div>

          {active === "resumen" && <>
            <section className="flex min-h-[170px] flex-col justify-between gap-5 rounded-[24px] bg-[radial-gradient(circle_at_90%_0%,rgba(94,206,219,.34),transparent_26rem),linear-gradient(125deg,#102c49,#155777_64%,#1b7891)] p-6 text-white shadow-xl shadow-slate-900/10 sm:p-8 md:flex-row md:items-center">
              <div><p className="mb-2 text-xs font-bold text-sky-200">Buenas noches, López</p><h2 className="mb-2 max-w-xl text-2xl font-black tracking-tight md:text-3xl">Todo lo importante, en un solo lugar.</h2><p className="max-w-2xl text-xs leading-6 text-sky-100">Cobertura, trámites, recetas y documentos con estado claro, historial y trazabilidad.</p></div>
              <button onClick={() => {setActive("tramites");flash("Listo para iniciar un trámite de demostración.");}} className="flex w-fit items-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-extrabold text-[#174664]"><Plus size={18}/>Nuevo trámite</button>
            </section>

            <div className="my-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
              {[
                [HeartPulse, "Cobertura", "Activa", "Plan integral"],
                [Clock3, "En curso", "2 trámites", "1 requiere seguimiento"],
                [Pill, "Recetas", "3 vigentes", "Vence en 12 días"],
                [FileCheck2, "Documentos", "8 guardados", "Todos verificados"],
              ].map(([Icon, label, value, detail], i) => {
                const I = Icon as typeof HeartPulse;
                return <article key={i} className="flex min-w-0 gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><I size={20}/></div><div className="min-w-0"><span className="block text-[9px] font-extrabold uppercase tracking-wider text-slate-400">{String(label)}</span><b className="my-0.5 block text-sm">{String(value)}</b><small className="block truncate text-[9px] text-slate-500">{String(detail)}</small></div></article>
              })}
            </div>

            <div className="grid gap-3 xl:grid-cols-[.92fr_1.08fr]">
              <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center justify-between"><div><p className="text-[10px] font-extrabold tracking-wider text-slate-500">MI CREDENCIAL</p><h3 className="text-base font-black">Cobertura activa</h3></div><CheckCircle2 className="text-emerald-600" size={22}/></div>
                <div className="mt-4 overflow-hidden rounded-2xl bg-gradient-to-br from-[#113450] to-[#1a6882] p-5 text-white shadow-lg shadow-sky-950/15">
                  <span className="text-[9px] tracking-wider text-sky-200">AFILIADO</span><b className="mt-1 block text-lg tracking-wide">LOPEZ · 00074219</b>
                  <div className="mt-4 flex justify-between text-[10px]"><span className="text-sky-200">Grupo</span><b>Fuerzas Armadas</b></div>
                  <div className="mt-2 flex justify-between text-[10px]"><span className="text-sky-200">Validez</span><b>Activa</b></div>
                  <div className="mt-4 flex items-center gap-1.5 text-[10px] text-sky-100"><ShieldCheck size={15}/>Identidad validada</div>
                </div>
                <button onClick={()=>setCredential(true)} className="mt-3 flex items-center gap-1 text-[11px] font-extrabold text-sky-700">Ver credencial completa <ChevronRight size={15}/></button>
              </article>

              <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center justify-between"><div><p className="text-[10px] font-extrabold tracking-wider text-slate-500">SEGUIMIENTO</p><h3 className="text-base font-black">Últimos movimientos</h3></div><Activity className="text-sky-700" size={22}/></div>
                <div className="mt-3">
                  {procedures.map((item) => <button key={item.title} onClick={()=>{setActive("tramites");flash(item.title);}} className="grid w-full grid-cols-[12px_minmax(0,1fr)] items-center gap-2 border-b border-slate-100 py-3 text-left last:border-0 sm:grid-cols-[12px_minmax(0,1fr)_auto]"><span className="h-2 w-2 rounded-full bg-sky-600 ring-4 ring-sky-50"/><div><b className="block text-[11px]">{item.title}</b><span className="block text-[10px] text-slate-500">{item.detail}</span><small className="text-[9px] text-slate-400">{item.date}</small></div><div className="col-start-2 sm:col-auto"><Status green={item.green}>{item.status}</Status></div></button>)}
                </div>
              </article>
            </div>

            <div className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
              <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <p className="text-[10px] font-extrabold tracking-wider text-slate-500">ACCESOS RÁPIDOS</p><h3 className="text-base font-black">Resolver sin llamar</h3>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    [Stethoscope,"Cartilla médica","Buscar por zona","prestadores"],
                    [Pill,"Mis recetas","Vigentes y vencimientos","recetas"],
                    [FileText,"Documentos","Todo ordenado","documentos"],
                    [Users,"Ayuda","Canal directo","resumen"],
                  ].map(([Icon,label,detail,target],i)=>{const I=Icon as typeof Stethoscope;return <button key={i} onClick={()=> target==="resumen"?flash("Canal de ayuda demo abierto."):setActive(target as Section)} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-left text-sky-700"><I size={19}/><b className="mt-2 block text-[11px] text-slate-800">{String(label)}</b><span className="text-[9px] text-slate-500">{String(detail)}</span></button>})}
                </div>
              </article>
              <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <p className="text-[10px] font-extrabold tracking-wider text-slate-500">PRÓXIMO PASO</p><h3 className="text-base font-black">Autorización de estudio</h3>
                <div className="mt-5 flex justify-between text-[10px]"><b>En revisión médica</b><span>75%</span></div>
                <div className="my-2 h-2 overflow-hidden rounded-full bg-slate-100"><i className="block h-full w-3/4 rounded-full bg-gradient-to-r from-sky-700 to-cyan-500"/></div>
                <p className="mb-4 text-[10px] leading-5 text-slate-500">La documentación ya fue recibida. No hace falta volver a cargarla ni llamar para consultar.</p>
                <button onClick={()=>setActive("tramites")} className="rounded-xl bg-[#176f8c] px-4 py-3 text-[11px] font-extrabold text-white">Ver detalle del trámite</button>
              </article>
            </div>
          </>}

          {active === "tramites" && <SectionShell eyebrow="TRÁMITES" title="Seguimiento sin llamadas ni papeles sueltos" desc="Cada paso queda registrado y el afiliado sabe quién tiene el trámite y qué falta." action={<button onClick={()=>flash("Trámite demo creado. No se enviaron datos reales.")} className="flex items-center gap-2 rounded-xl bg-[#176f8c] px-4 py-3 text-[11px] font-extrabold text-white"><Plus size={17}/>Iniciar trámite</button>}>
            <div className="mt-3">{procedures.map((item,i)=><button key={item.title} onClick={()=>flash(`Detalle abierto: ${item.title}`)} className="grid w-full grid-cols-[42px_minmax(0,1fr)_18px] items-center gap-3 border-b border-slate-100 py-4 text-left sm:grid-cols-[42px_minmax(0,1fr)_auto_18px]"><div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700">{i===0?<Stethoscope size={20}/>:i===1?<ReceiptText size={20}/>:<Pill size={20}/>}</div><div><b className="block text-xs">{item.title}</b><span className="text-[10px] text-slate-500">{item.detail}</span><small className="block text-[9px] text-slate-400">Actualizado {item.date}</small></div><div className="col-start-2 sm:col-auto"><Status green={item.green}>{item.status}</Status></div><ChevronRight size={17}/></button>)}</div>
          </SectionShell>}

          {active === "recetas" && <SectionShell eyebrow="RECETAS Y MEDICACIÓN" title="Vigencia, autorización y retiro" desc="El usuario ve qué puede retirar, hasta cuándo y dónde, sin reconstruir el estado por distintos canales.">
            <div className="mt-5 grid gap-2">{[
              ["Medicamento crónico A","Vigente hasta 16 oct","Autorizado",true],
              ["Tratamiento B","Vigente hasta 28 oct","Disponible",true],
              ["Medicación especial C","Renovación solicitada","En revisión",false],
            ].map(([name,detail,status,green])=><article key={String(name)} className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><Pill size={20}/></div><div><b className="block text-xs">{String(name)}</b><span className="text-[10px] text-slate-500">{String(detail)}</span></div><Status green={Boolean(green)}>{String(status)}</Status></article>)}</div>
          </SectionShell>}

          {active === "prestadores" && <SectionShell eyebrow="PRESTADORES" title="Cartilla simple y útil" desc="Prestadores filtrados por cobertura, ubicación y disponibilidad informada.">
            <div className="mt-5 grid gap-2">{[
              ["Centro Médico Central","Clínica médica · Diagnóstico","1,2 km"],
              ["Consultorios del Sur","Clínica · Odontología","2,8 km"],
              ["Farmacia Convenio","Medicamentos · Descuento","900 m"],
            ].map(([name,detail,distance])=><article key={name} className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[42px_minmax(0,1fr)_auto_auto]"><div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><MapPin size={20}/></div><div><b className="block text-xs">{name}</b><span className="text-[10px] text-slate-500">{detail}</span></div><small className="text-[9px] text-slate-500">{distance}</small><button onClick={()=>flash(`Prestador seleccionado: ${name}`)} className="col-start-2 rounded-lg bg-sky-50 px-3 py-2 text-[10px] font-extrabold text-sky-700 sm:col-auto">Ver</button></article>)}</div>
          </SectionShell>}

          {active === "documentos" && <SectionShell eyebrow="DOCUMENTOS" title="Una carpeta, un historial" desc="El afiliado evita volver a mandar archivos que ya fueron validados." action={<button onClick={()=>flash("Carga demo: usar únicamente archivos de prueba.")} className="flex items-center gap-2 rounded-xl bg-[#176f8c] px-4 py-3 text-[11px] font-extrabold text-white"><Plus size={17}/>Agregar</button>}>
            <div className="mt-3">{["DNI — frente y dorso","Orden médica — Ecografía","Comprobante — Consulta","Constancia de afiliación"].map((file,i)=><button key={file} onClick={()=>flash(`Documento demo: ${file}`)} className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto_18px] items-center gap-3 border-b border-slate-100 py-4 text-left"><FileText className="text-sky-700" size={20}/><div><b className="block text-[11px]">{file}</b><span className="text-[9px] text-slate-500">PDF · verificado</span></div><small className="text-[9px] text-slate-400">{["Hoy","Hoy","02 oct","18 sep"][i]}</small><ChevronRight size={17}/></button>)}</div>
          </SectionShell>}

          {active === "seguridad" && <SectionShell eyebrow="SEGURIDAD Y TRAZABILIDAD" title="Quién accedió, qué cambió y cuándo" desc="Permisos claros, registro de actividad y protección adicional para operaciones sensibles.">
            <div className="mt-5 grid gap-2 md:grid-cols-3">{[
              [LockKeyhole,"Doble factor","Protección adicional para accesos sensibles.","Activo"],
              [ShieldCheck,"Acceso por rol","Cada área visualiza únicamente lo que necesita.","Aplicado"],
              [FileCheck2,"Auditoría","Lecturas, cambios y aprobaciones quedan registradas.","Registrando"],
            ].map(([Icon,name,desc,status],i)=>{const I=Icon as typeof ShieldCheck;return <article key={i} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sky-700"><I size={22}/><b className="mt-3 block text-xs text-slate-800">{String(name)}</b><span className="mb-3 mt-1 block text-[9px] leading-4 text-slate-500">{String(desc)}</span><Status green>{String(status)}</Status></article>})}</div>
            <div className="mt-6 border-t border-slate-100 pt-4"><h3 className="mb-2 text-sm font-black">Actividad reciente</h3>{[
              ["Sistema","Documento recibido y asociado al trámite","Hoy · 14:20"],
              ["Auditoría","Orden médica validada","Hoy · 15:02"],
              ["Afiliado","Consulta de estado","Hoy · 20:44"],
            ].map(([who,what,when])=><div key={what} className="grid grid-cols-[75px_minmax(0,1fr)] gap-3 border-b border-slate-100 py-3 text-[10px] sm:grid-cols-[90px_minmax(0,1fr)_auto]"><span className="font-extrabold text-sky-700">{who}</span><b>{what}</b><small className="col-start-2 text-slate-400 sm:col-auto">{when}</small></div>)}</div>
          </SectionShell>}

          <footer className="mt-5 flex flex-col justify-between gap-1 border-t border-slate-200 pt-4 text-[9px] text-slate-400 sm:flex-row sm:gap-4">
            <span>Prototipo independiente desarrollado en CLOUVA.</span>
            <span>No pertenece ni representa oficialmente a OSFA/IOSFA. Todos los datos son ficticios.</span>
          </footer>
        </section>
      </div>

      {toast && <div className="fixed bottom-4 left-4 right-4 z-[70] flex items-center gap-2 rounded-2xl bg-[#153b55] px-4 py-3 text-[11px] font-bold text-white shadow-2xl sm:left-auto sm:right-6 sm:w-auto"><CheckCircle2 size={18}/>{toast}</div>}

      {credential && <div onClick={()=>setCredential(false)} className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/55 p-5 backdrop-blur-sm">
        <div onClick={(e)=>e.stopPropagation()} className="relative w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
          <button onClick={()=>setCredential(false)} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500"><X size={18}/></button>
          <p className="text-[9px] font-extrabold tracking-[.13em] text-slate-500">IDENTIDAD DIGITAL · DEMO</p>
          <div className="mx-auto mb-3 mt-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#174b70] to-[#2388a5] text-2xl font-black text-white">L</div>
          <h2 className="text-xl font-black">López</h2><span className="text-[10px] text-slate-500">Afiliado · Fuerzas Armadas</span>
          <div className="my-5 border-t border-slate-100 text-left text-[10px]">{[["Número de afiliado","00074219"],["Cobertura","Activa"],["Identidad","Validada"]].map(([k,v])=><div key={k} className="flex justify-between border-b border-slate-100 py-3"><span className="text-slate-500">{k}</span><b>{v}</b></div>)}</div>
          <small className="text-[9px] text-slate-400">Datos totalmente ficticios para demostración.</small>
        </div>
      </div>}
    </main>
  );
}

function SectionShell({ eyebrow, title, desc, action, children }: { eyebrow: string; title: string; desc: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="min-h-[600px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
      <div><p className="mb-1 text-[10px] font-extrabold tracking-[.11em] text-slate-500">{eyebrow}</p><h2 className="mb-2 text-xl font-black tracking-tight sm:text-2xl">{title}</h2><span className="block max-w-2xl text-[11px] leading-5 text-slate-500">{desc}</span></div>{action}
    </div>{children}
  </section>;
}
