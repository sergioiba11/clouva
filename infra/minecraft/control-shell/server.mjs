import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const API_UPSTREAM = (process.env.MC_API_UPSTREAM || "").replace(/\/$/, "");

const ASSET_ROOT = "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/clouva-logo/shared/other";
const assets = {
  background: ASSET_ROOT + "/ratcraft_background_mobile_vertical.png",
  poster: ASSET_ROOT + "/ratcraft_poster_mobile.png",
  logo: ASSET_ROOT + "/ratcraft_logo_principal.png",
  start: ASSET_ROOT + "/ratcraft_boton_prender_server.png",
  inicio: ASSET_ROOT + "/ratcraft_btn_inicio.png",
  mapa: ASSET_ROOT + "/ratcraft_btn_mapa.png",
  jugadores: ASSET_ROOT + "/ratcraft_btn_jugadores.png",
  tienda: ASSET_ROOT + "/ratcraft_btn_tienda.png",
};

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#09010f" />
<title>Ratcraft × CLOUVA</title>
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#07010d;color:#fff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{overflow-x:hidden}
.hero{position:relative;min-height:100svh;overflow:hidden;background:#07010d}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 54%;filter:saturate(1.08) contrast(1.03);transform:scale(1.025)}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,1,15,.38) 0%,rgba(7,1,15,.04) 24%,rgba(7,1,15,.06) 62%,rgba(7,1,15,.72) 100%)}
.glow{position:absolute;inset:0;background:radial-gradient(circle at 50% 43%,rgba(217,70,239,.08),transparent 48%)}
.wrap{position:relative;z-index:2;max-width:1700px;min-height:100svh;margin:auto;padding:14px 22px 12px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:flex-end;gap:12px;border:1px solid rgba(232,121,249,.22);background:rgba(10,3,20,.70);backdrop-filter:blur(16px);border-radius:22px;padding:10px 14px;box-shadow:0 16px 54px rgba(0,0,0,.30)}
.brand{display:flex;align-items:center;gap:10px;font-weight:1000;letter-spacing:.08em}.mark{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;border:1px solid rgba(232,121,249,.3);background:rgba(217,70,239,.12);font-size:22px}.brand small{display:block;margin-top:3px;font-size:9px;letter-spacing:.22em;color:rgba(245,208,254,.72)}
.statuses{display:flex;gap:8px;align-items:center}.pill{border:1px solid rgba(232,121,249,.25);background:rgba(0,0,0,.35);border-radius:14px;padding:9px 12px;font-size:11px;font-weight:900;display:flex;align-items:center;gap:8px}.dot{width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 14px #22c55e}
.center{width:100%;max-width:900px;margin:auto;display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12px 0 4px}
.logo{width:min(46vw,610px);max-width:92vw;filter:drop-shadow(0 20px 50px rgba(168,85,247,.42));user-select:none}
.tag{margin-top:-2px;font-weight:950;letter-spacing:.05em;text-shadow:0 2px 10px rgba(0,0,0,.75);font-size:16px}
.crown{display:flex;gap:12px;align-items:center;margin:8px 0;color:#f0abfc}.crown:before,.crown:after{content:"";height:1px;width:64px;background:linear-gradient(90deg,transparent,#f0abfc)}.crown:after{transform:scaleX(-1)}
.start{border:0;background:transparent;padding:0;margin:8px 0 0;width:min(44vw,610px);max-width:94vw;cursor:pointer;transition:.2s;filter:drop-shadow(0 0 22px rgba(217,70,239,.30))}.start:hover{transform:scale(1.018);filter:drop-shadow(0 0 34px rgba(217,70,239,.50))}.start:active{transform:scale(.985)}.start img{width:100%;display:block;transition:.22s}.start.is-disabled{cursor:not-allowed;pointer-events:none;transform:none!important;filter:grayscale(1) brightness(.62) drop-shadow(0 0 10px rgba(255,255,255,.08));opacity:.9}.start.is-disabled img{filter:grayscale(1)}
.note{min-height:22px;margin-top:2px;font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#86efac}
.nav{margin-top:8px;width:100%;max-width:820px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.nav a,.nav button{border:0;background:transparent;padding:0;cursor:pointer;transition:.2s}.nav a:hover,.nav button:hover{transform:translateY(-3px);filter:drop-shadow(0 0 22px rgba(217,70,239,.32))}.nav img{width:100%;display:block}
.foot{display:flex;align-items:center;justify-content:center;gap:15px;color:rgba(255,255,255,.58);font-size:10px;font-weight:950;letter-spacing:.3em;text-transform:uppercase}.line{height:1px;max-width:240px;flex:1;background:linear-gradient(90deg,transparent,rgba(232,121,249,.5),transparent)}
.panel{position:fixed;z-index:6;left:50%;bottom:18px;transform:translateX(-50%) translateY(160%);width:min(94vw,640px);border:1px solid rgba(232,121,249,.28);background:rgba(8,2,16,.92);backdrop-filter:blur(18px);border-radius:24px;padding:16px;box-shadow:0 24px 80px rgba(0,0,0,.55);transition:.25s}.panel.show{transform:translateX(-50%) translateY(0)}.panel h3{margin:0 0 10px}.row{display:flex;gap:8px;flex-wrap:wrap}.code{flex:1;min-width:180px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);border-radius:14px;padding:10px 12px;font-family:ui-monospace,monospace;font-size:12px}.close{border:1px solid rgba(232,121,249,.24);background:rgba(217,70,239,.12);color:#fff;border-radius:12px;padding:9px 12px;font-weight:900;cursor:pointer}
@media(max-width:760px){
  .wrap{padding:9px 9px 8px}.top{border-radius:17px;padding:8px 9px}.mark{width:34px;height:34px;font-size:18px}.brand{font-size:14px}.brand small{display:none}.statuses .pill{padding:7px 9px;font-size:10px}.statuses .pill:nth-child(2){display:none}
  .center{padding-top:8px;justify-content:flex-start}.logo{width:min(88vw,440px);margin-top:4vh}.tag{font-size:12px}.crown{margin:5px 0}.crown:before,.crown:after{width:42px}
  .start{width:min(92vw,560px);margin-top:8px}.note{font-size:9px}
  .nav{grid-template-columns:repeat(2,1fr);gap:5px;max-width:560px;padding:0 4px;margin-top:4px}.nav a:nth-child(n+3),.nav button:nth-child(n+3){margin-top:-2px}
  .foot{font-size:8px;letter-spacing:.22em;margin-top:4px}
}
@media(min-width:1100px) and (max-height:850px){.logo{width:min(38vw,500px)}.start{width:min(38vw,520px)}.nav{max-width:720px}.center{padding-top:4px}.tag{font-size:14px}}
</style>
</head>
<body>
<main class="hero">
  <img class="bg" src="${assets.background}" alt="" />
  <div class="shade"></div><div class="glow"></div>
  <div class="wrap">
    <header class="top">
      <div class="statuses">
        <div class="pill"><span id="dot" class="dot"></span><span id="serverState">Servidor en línea</span></div>
        <div class="pill">♟ <span id="players">0</span> jugadores</div>
      </div>
    </header>

    <section class="center">
      <img class="logo" src="${assets.logo}" alt="Niños Rata Server" />
      <div class="tag">Más que un servidor, una banda.</div>
      <div class="crown">♕</div>

      <button class="start" id="startBtn"><img src="${assets.start}" alt="Prender server" /></button>
      <div class="note" id="note">Cargando estado...</div>

      <nav class="nav">
        <button id="homeBtn"><img src="${assets.inicio}" alt="Inicio" /></button>
        <button id="mapBtn"><img src="${assets.mapa}" alt="Mapa" /></button>
        <button id="playersBtn"><img src="${assets.jugadores}" alt="Jugadores" /></button>
        <a href="/tienda"><img src="${assets.tienda}" alt="Tienda" /></a>
      </nav>
    </section>

    <footer class="foot"><span class="line"></span><span>RATCRAFT × CLOUVA</span><span class="line"></span></footer>
  </div>
</main>

<div class="panel" id="panel">
  <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
    <h3 id="panelTitle">Ratcraft</h3><button class="close" id="closePanel">Cerrar</button>
  </div>
  <div id="panelBody" class="row"></div>
</div>

<script>
const panel=document.getElementById("panel");
const panelTitle=document.getElementById("panelTitle");
const panelBody=document.getElementById("panelBody");
const note=document.getElementById("note");
const startBtn=document.getElementById("startBtn");
let statusData=null;
let startRequested=false;

function setStartDisabled(disabled){
  startBtn.disabled=disabled;
  startBtn.setAttribute("aria-disabled",disabled?"true":"false");
  startBtn.classList.toggle("is-disabled",disabled);
}

function showPanel(title, body){panelTitle.textContent=title;panelBody.innerHTML=body;panel.classList.add("show")}
document.getElementById("closePanel").onclick=()=>panel.classList.remove("show");
document.getElementById("homeBtn").onclick=()=>panel.classList.remove("show");

async function load(){
  try{
    const r=await fetch("/minecraft/api/full",{cache:"no-store"});
    const d=await r.json();
    statusData=d;
    const online=String(d.status||"").toLowerCase()==="running"||d.online===true||d.status===true;
    document.getElementById("serverState").textContent=online?"Servidor en línea":"Servidor apagado";
    document.getElementById("dot").style.background=online?"#22c55e":"#71717a";
    document.getElementById("dot").style.boxShadow=online?"0 0 14px #22c55e":"none";
    const list=Array.isArray(d.players)?d.players:(Array.isArray(d.playerList)?d.playerList:[]);
    const count=typeof d.players==="number"?d.players:(d.playerCount??d.onlinePlayers??list.length??0);
    document.getElementById("players").textContent=count||0;
    if(online){
      startRequested=false;
      setStartDisabled(true);
      note.textContent="LISTO PARA ENTRAR";
    }else{
      setStartDisabled(startRequested);
      note.textContent=startRequested?"ARRANCANDO SERVER...":"TOCÁ PRENDER SERVER";
    }
  }catch(e){
    note.textContent="RATCRAFT";
  }
}

startBtn.onclick=async()=>{
  const online=statusData&&(String(statusData.status||"").toLowerCase()==="running"||statusData.online===true||statusData.status===true);
  if(online||startRequested) return;

  startRequested=true;
  setStartDisabled(true);
  note.textContent="PRENDIENDO...";

  try{
    const r=await fetch("/minecraft/api/start",{method:"POST"});
    if(!r.ok) throw new Error("start");
    note.textContent="ARRANCANDO SERVER...";
    setTimeout(load,2500);
  }catch(e){
    startRequested=false;
    setStartDisabled(false);
    note.textContent="NO SE PUDO PRENDER · TOCÁ PARA REINTENTAR";
  }
};

document.getElementById("mapBtn").onclick=()=>showPanel("Mapa en vivo",'<div class="code">El mapa se abre cuando Ratcraft está online.</div>');
document.getElementById("playersBtn").onclick=()=>{
  const d=statusData||{};
  const list=Array.isArray(d.players)?d.players:(Array.isArray(d.playerList)?d.playerList:[]);
  showPanel("Jugadores", list.length?list.map(x=>'<div class="code">'+(typeof x==="string"?x:(x.name||"Jugador"))+'</div>').join(""):'<div class="code">No hay jugadores conectados.</div>');
};

load(); setInterval(load,10000);
</script>
</body>
</html>`;

async function proxy(req, res, pathname, search) {
  if (!API_UPSTREAM) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Minecraft API upstream is not configured" }));
    return;
  }

  let upstreamPath = pathname;
  if (upstreamPath.startsWith("/minecraft/api/")) upstreamPath = upstreamPath.slice("/minecraft".length);
  const target = API_UPSTREAM + upstreamPath + search;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  const body = [];
  for await (const chunk of req) body.push(chunk);
  const init = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(req.method || "GET")) init.body = Buffer.concat(body);

  const response = await fetch(target, init);
  const outHeaders = {};
  response.headers.forEach((value, key) => { outHeaders[key] = value; });
  outHeaders["cache-control"] = "no-store";
  res.writeHead(response.status, outHeaders);
  if (req.method === "HEAD") return res.end();
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname === "/" || pathname === "/minecraft" || pathname === "/minecraft/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      });
      return res.end(html);
    }

    if (pathname === "/health" || pathname === "/minecraft/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ ok: true, shell: "ratcraft" }));
    }

    if (pathname.startsWith("/api/") || pathname.startsWith("/minecraft/api/")) {
      return await proxy(req, res, pathname, url.search);
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Ratcraft shell listening on", PORT);
});
