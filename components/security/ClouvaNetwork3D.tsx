"use client";

import { Html, Line, OrbitControls, Grid } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { Vector3 } from "three";

export type ClouvaNetworkSnapshot = {
  scannedAt?: string;
  scanner?: string;
  local?: {
    hostname?: string | null;
    interface?: string | null;
    ip?: string | null;
    mac?: string | null;
    subnet?: string | null;
    gateway?: string | null;
    dns?: string[];
  };
  activity?: {
    foregroundProcess?: string | null;
    foregroundPid?: number | null;
    foregroundTitle?: string | null;
    observedAt?: string | null;
  };
  devices?: Array<{
    ip: string;
    hostname?: string | null;
    mac?: string | null;
    vendor?: string | null;
    status?: string | null;
    ports?: Array<{
      port: number;
      protocol?: string;
      service?: string | null;
      state?: string;
    }>;
  }>;
  connections?: Array<{
    protocol?: string;
    localAddress?: string;
    localPort?: number;
    remoteAddress: string;
    remotePort?: number;
    process?: string | null;
    pid?: number | null;
    hostname?: string | null;
  }>;
};

export type PublicNetworkAsset = {
  id: string;
  label: string;
  host: string;
  kind: "web" | "game";
  ips: string[];
  dnsOk: boolean;
  reachable: boolean;
  latencyMs: number | null;
  httpStatus?: number | null;
  tls?: {
    valid: boolean;
    protocol: string | null;
    issuer: string | null;
    validTo: string | null;
    daysRemaining: number | null;
  } | null;
  exposedPorts?: Array<{
    port: number;
    service: string;
    reachable: boolean;
    latencyMs: number | null;
  }>;
  error?: string | null;
};

type NodeStatus = "live" | "known" | "offline" | "unknown";
type NodeKind =
  | "core"
  | "cloud"
  | "service"
  | "sensor"
  | "gateway"
  | "device"
  | "destination"
  | "game";

type GraphNode = {
  id: string;
  label: string;
  subtitle: string;
  kind: NodeKind;
  status: NodeStatus;
  position: [number, number, number];
  facts: Array<[string, string]>;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: "infra" | "sensor" | "lan" | "live";
  active?: boolean;
};

type Props = {
  snapshot: ClouvaNetworkSnapshot | null;
  assets?: PublicNetworkAsset[];
  workspaceError?: string | null;
};

const NODE_TONES: Record<NodeKind, string> = {
  core: "#d8b4fe",
  cloud: "#60a5fa",
  service: "#22d3ee",
  sensor: "#38bdf8",
  gateway: "#a78bfa",
  device: "#67e8f9",
  destination: "#34d399",
  game: "#facc15",
};

const EDGE_TONES = {
  infra: "#64748b",
  sensor: "#38bdf8",
  lan: "#22d3ee",
  live: "#34d399",
} as const;

function validRemote(address?: string) {
  if (!address || address === "127.0.0.1" || address === "::1") return false;
  if (address === "0.0.0.0" || address === "::") return false;
  return true;
}

function architectureNodes(): GraphNode[] {
  return [
    {
      id: "clouva",
      label: "CLOUVA",
      subtitle: "núcleo",
      kind: "core",
      status: "live",
      position: [0, 0, 0],
      facts: [
        ["Rol", "núcleo de la app"],
        ["Vista", "red viva 3D"],
      ],
    },
    {
      id: "cloud-run",
      label: "GOOGLE CLOUD RUN",
      subtitle: "clouva-web · us-central1",
      kind: "cloud",
      status: "known",
      position: [3.1, 3.5, -1.5],
      facts: [
        ["Servicio", "clouva-web"],
        ["Región", "us-central1"],
        ["Evidencia", "workflow de deploy"],
      ],
    },
    {
      id: "supabase",
      label: "SUPABASE",
      subtitle: "auth · db · storage",
      kind: "service",
      status: "known",
      position: [4.2, -2.7, 1.4],
      facts: [
        ["Uso", "auth / base de datos / storage"],
        ["Evidencia", "cliente y migraciones CLOUVA"],
      ],
    },
    {
      id: "github",
      label: "GITHUB",
      subtitle: "sergioiba11/clouva",
      kind: "service",
      status: "known",
      position: [-1.5, 4.2, -2],
      facts: [
        ["Repo", "sergioiba11/clouva"],
        ["Uso", "código / acciones / deploy"],
      ],
    },
    {
      id: "cloudflare",
      label: "CLOUDFLARE / DNS",
      subtitle: "borde de dominio",
      kind: "cloud",
      status: "known",
      position: [-3.7, 2.1, 1.7],
      facts: [
        ["Uso", "DNS / dominio / borde"],
        ["Estado", "arquitectura conocida"],
      ],
    },
    {
      id: "mercadopago",
      label: "MERCADOPAGO",
      subtitle: "pagos / webhooks",
      kind: "service",
      status: "known",
      position: [-4.1, -1.9, -1.2],
      facts: [
        ["Uso", "checkout y webhooks"],
        ["Evidencia", "billing provider CLOUVA"],
      ],
    },
    {
      id: "resend",
      label: "RESEND",
      subtitle: "correo",
      kind: "service",
      status: "known",
      position: [-2.3, -3.6, 1.2],
      facts: [
        ["Uso", "email transaccional"],
        ["Estado", "integración conocida"],
      ],
    },
  ];
}

function assetNode(asset: PublicNetworkAsset): GraphNode {
  const isGame = asset.kind === "game";
  return {
    id: asset.id,
    label: isGame ? "RATCRAFT" : "CLOUVA.COM.AR",
    subtitle: asset.host,
    kind: isGame ? "game" : "cloud",
    status: asset.reachable ? "live" : "offline",
    position: isGame ? [5.7, -1.6, -3.7] : [5.7, 1.8, -2.8],
    facts: [
      ["Host", asset.host],
      ["IP", asset.ips.join(" · ") || "sin resolver"],
      ["Estado", asset.reachable ? "alcanzable" : "sin respuesta"],
      ["Latencia", asset.latencyMs == null ? "—" : asset.latencyMs + " ms"],
      ...(asset.tls
        ? [["TLS", asset.tls.valid ? String(asset.tls.protocol || "válido") : "inválido"] as [string, string]]
        : []),
    ],
  };
}

function buildGraph(snapshot: ClouvaNetworkSnapshot | null, assets: PublicNetworkAsset[]) {
  const nodes = architectureNodes();
  const edges: GraphEdge[] = [
    { id: "clouva-cloudrun", from: "clouva", to: "cloud-run", kind: "infra" },
    { id: "clouva-supabase", from: "clouva", to: "supabase", kind: "infra" },
    { id: "clouva-github", from: "clouva", to: "github", kind: "infra" },
    { id: "clouva-cloudflare", from: "clouva", to: "cloudflare", kind: "infra" },
    { id: "clouva-mercadopago", from: "clouva", to: "mercadopago", kind: "infra" },
    { id: "clouva-resend", from: "clouva", to: "resend", kind: "infra" },
  ];

  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const asset of assets) {
    const node = assetNode(asset);
    const existing = byId.get(node.id);
    if (existing) Object.assign(existing, node);
    else {
      nodes.push(node);
      byId.set(node.id, node);
    }

    edges.push({
      id: "clouva-" + node.id,
      from: "clouva",
      to: node.id,
      kind: node.status === "live" ? "live" : "infra",
      active: node.status === "live",
    });
  }

  if (snapshot?.local?.ip) {
    nodes.push({
      id: "workspace",
      label: "WORKSPACE / PC",
      subtitle: snapshot.local.hostname || snapshot.local.ip,
      kind: "sensor",
      status: "live",
      position: [-6.1, 0.2, 0.2],
      facts: [
        ["IP", snapshot.local.ip],
        ["Interfaz", snapshot.local.interface || "—"],
        ["Subred", snapshot.local.subnet || "—"],
        ["Actividad", snapshot.activity?.foregroundTitle || snapshot.activity?.foregroundProcess || "—"],
      ],
    });
    edges.push({
      id: "workspace-clouva",
      from: "workspace",
      to: "clouva",
      kind: "sensor",
      active: true,
    });

    if (snapshot.local.gateway) {
      nodes.push({
        id: "gateway",
        label: "ROUTER / GATEWAY",
        subtitle: snapshot.local.gateway,
        kind: "gateway",
        status: "live",
        position: [-8.2, -2.4, 0.3],
        facts: [
          ["Gateway", snapshot.local.gateway],
          ["Subred", snapshot.local.subnet || "—"],
          ["DNS", snapshot.local.dns?.join(" · ") || "—"],
        ],
      });
      edges.push({
        id: "workspace-gateway",
        from: "workspace",
        to: "gateway",
        kind: "lan",
        active: true,
      });
    }

    const lan = (snapshot.devices || []).filter(
      (device) => device.ip !== snapshot.local?.ip && device.ip !== snapshot.local?.gateway,
    );

    lan.slice(0, 10).forEach((device, index) => {
      const angle = (index / Math.max(1, Math.min(lan.length, 10))) * Math.PI * 2;
      const node: GraphNode = {
        id: "lan:" + device.ip,
        label: device.hostname || device.vendor || device.ip,
        subtitle: device.ip,
        kind: "device",
        status: "live",
        position: [
          -8.2 + Math.cos(angle) * 2.6,
          0.5 + ((index % 3) - 1) * 1.3,
          Math.sin(angle) * 2.6,
        ],
        facts: [
          ["IP", device.ip],
          ["MAC", device.mac || "—"],
          ["Fabricante", device.vendor || "—"],
          ["Puertos", String(device.ports?.length || 0)],
        ],
      };
      nodes.push(node);
      edges.push({
        id: "workspace-" + node.id,
        from: "workspace",
        to: node.id,
        kind: "lan",
        active: true,
      });
    });

    const grouped = new Map<string, {
      id: string;
      process: string;
      address: string;
      port: number | undefined;
      count: number;
      hostname?: string | null;
    }>();

    for (const connection of snapshot.connections || []) {
      if (!validRemote(connection.remoteAddress)) continue;
      const id = [
        connection.process || "proceso",
        connection.remoteAddress,
        connection.remotePort || 0,
      ].join(":");
      const existing = grouped.get(id);
      if (existing) existing.count += 1;
      else {
        grouped.set(id, {
          id,
          process: connection.process || "proceso",
          address: connection.remoteAddress,
          port: connection.remotePort,
          count: 1,
          hostname: connection.hostname,
        });
      }
    }

    const destinations = [...grouped.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 14);

    destinations.forEach((destination, index) => {
      const angle = (index / Math.max(1, destinations.length)) * Math.PI * 2;
      const radius = 10.5;
      const node: GraphNode = {
        id: "dest:" + destination.id,
        label: destination.hostname || destination.process.toUpperCase(),
        subtitle: destination.address + (destination.port ? ":" + destination.port : ""),
        kind: "destination",
        status: "live",
        position: [
          Math.cos(angle) * radius,
          ((index % 5) - 2) * 1.35,
          Math.sin(angle) * radius,
        ],
        facts: [
          ["Proceso", destination.process],
          ["Destino", destination.address],
          ["Puerto", destination.port ? String(destination.port) : "—"],
          ["Conexiones", String(destination.count)],
        ],
      };
      nodes.push(node);
      edges.push({
        id: "gateway-" + node.id,
        from: snapshot.local.gateway ? "gateway" : "workspace",
        to: node.id,
        kind: "live",
        active: true,
      });
    });
  } else {
    nodes.push({
      id: "workspace",
      label: "WORKSPACE / PC",
      subtitle: "sensor sin señal",
      kind: "sensor",
      status: "offline",
      position: [-6.1, 0.2, 0.2],
      facts: [
        ["Estado", "sin telemetría"],
        ["Función", "sensor local de red"],
      ],
    });
    edges.push({
      id: "workspace-clouva",
      from: "workspace",
      to: "clouva",
      kind: "sensor",
      active: false,
    });
  }

  return { nodes, edges };
}

function statusOpacity(status: NodeStatus) {
  if (status === "offline") return 0.38;
  if (status === "unknown") return 0.5;
  if (status === "known") return 0.72;
  return 1;
}

function NodeMesh({
  node,
  selected,
  onSelect,
}: {
  node: GraphNode;
  selected: boolean;
  onSelect: (node: GraphNode) => void;
}) {
  const group = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const tone = NODE_TONES[node.kind];

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    const pulse = node.status === "live" ? 1 + Math.sin(t * 2.2 + node.position[0]) * 0.035 : 1;
    const selectedScale = selected ? 1.18 : 1;
    group.current.scale.setScalar(pulse * selectedScale);
    if (core.current && node.kind === "core") {
      core.current.rotation.y += 0.006;
      core.current.rotation.x += 0.002;
    }
  });

  const geometry =
    node.kind === "device" || node.kind === "sensor" || node.kind === "gateway"
      ? <boxGeometry args={[1.05, 1.05, 1.05]} />
      : node.kind === "service"
        ? <octahedronGeometry args={[0.72, 0]} />
        : node.kind === "game"
          ? <dodecahedronGeometry args={[0.8, 0]} />
          : <icosahedronGeometry args={[0.82, node.kind === "core" ? 2 : 1]} />;

  return (
    <group ref={group} position={node.position}>
      {selected ? (
        <mesh scale={1.55}>
          <sphereGeometry args={[0.8, 28, 28]} />
          <meshBasicMaterial color={tone} transparent opacity={0.1} depthWrite={false} />
        </mesh>
      ) : null}

      {node.status === "live" ? (
        <mesh rotation={[Math.PI / 2, 0, 0]} scale={selected ? 1.35 : 1.15}>
          <torusGeometry args={[0.92, 0.025, 8, 64]} />
          <meshBasicMaterial color={tone} transparent opacity={0.5} />
        </mesh>
      ) : null}

      <mesh
        ref={core}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node);
        }}
      >
        {geometry}
        <meshStandardMaterial
          color={tone}
          emissive={tone}
          emissiveIntensity={selected ? 1.35 : node.status === "live" ? 0.68 : 0.25}
          roughness={0.25}
          metalness={0.2}
          transparent
          opacity={statusOpacity(node.status)}
        />
      </mesh>

      <Html position={[0, 1.25, 0]} center distanceFactor={9} zIndexRange={[20, 0]}>
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="pointer-events-auto min-w-[118px] max-w-[190px] rounded-xl border border-white/10 bg-[#050a10]/90 px-2.5 py-2 text-left shadow-xl shadow-black/40 backdrop-blur-xl"
        >
          <div className="truncate text-[10px] font-black tracking-[.06em] text-white">
            {node.label}
          </div>
          <div className="mt-0.5 truncate font-mono text-[8px] text-white/40">
            {node.subtitle}
          </div>
          <div className="mt-1 text-[7px] font-black uppercase tracking-[.12em]" style={{ color: tone }}>
            {node.status === "live" ? "LIVE" : node.status === "known" ? "CONOCIDO" : node.status === "offline" ? "SIN SEÑAL" : "DESCONOCIDO"}
          </div>
        </button>
      </Html>
    </group>
  );
}

function FlowDot({
  from,
  to,
  offset,
  color,
}: {
  from: [number, number, number];
  to: [number, number, number];
  offset: number;
  color: string;
}) {
  const ref = useRef<Mesh>(null);
  const a = useMemo(() => new Vector3(...from), [from]);
  const b = useMemo(() => new Vector3(...to), [to]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * 0.22 + offset) % 1;
    ref.current.position.lerpVectors(a, b, t);
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.075, 12, 12]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function GraphScene({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (node: GraphNode) => void;
}) {
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return (
    <>
      <color attach="background" args={["#02050a"]} />
      <fog attach="fog" args={["#02050a", 14, 31]} />

      <ambientLight intensity={0.62} />
      <pointLight position={[0, 4, 6]} intensity={35} distance={25} color="#a5f3fc" />
      <pointLight position={[6, -5, -4]} intensity={22} distance={20} color="#a78bfa" />

      <Grid
        position={[0, -5.2, 0]}
        args={[40, 40]}
        cellSize={1}
        cellThickness={0.45}
        cellColor="#12323d"
        sectionSize={5}
        sectionThickness={0.8}
        sectionColor="#164e63"
        fadeDistance={28}
        fadeStrength={1.5}
        infiniteGrid
      />

      {edges.map((edge, edgeIndex) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const color = EDGE_TONES[edge.kind];
        const opacity = edge.active ? 0.8 : edge.kind === "infra" ? 0.22 : 0.38;

        return (
          <group key={edge.id}>
            <Line
              points={[from.position, to.position]}
              color={color}
              lineWidth={edge.active ? 1.7 : 0.8}
              transparent
              opacity={opacity}
            />
            {edge.active ? (
              <>
                <FlowDot from={from.position} to={to.position} offset={(edgeIndex % 3) / 3} color={color} />
                <FlowDot from={from.position} to={to.position} offset={((edgeIndex % 3) + 1) / 3} color={color} />
              </>
            ) : null}
          </group>
        );
      })}

      {nodes.map((node) => (
        <NodeMesh
          key={node.id}
          node={node}
          selected={selectedId === node.id}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
        zoomSpeed={0.8}
        panSpeed={0.7}
        minDistance={5}
        maxDistance={34}
        target={[0, 0, 0]}
      />
    </>
  );
}

export function ClouvaNetwork3D({ snapshot, assets = [], workspaceError }: Props) {
  const { nodes, edges } = useMemo(() => buildGraph(snapshot, assets), [assets, snapshot]);
  const [selectedId, setSelectedId] = useState<string | null>("clouva");
  const selected = nodes.find((node) => node.id === selectedId) || null;

  const liveNodes = nodes.filter((node) => node.status === "live").length;
  const activeEdges = edges.filter((edge) => edge.active).length;

  return (
    <section className="relative h-[calc(100vh-188px)] min-h-[620px] overflow-hidden rounded-[26px] border border-cyan-300/10 bg-[#02050a] shadow-[0_30px_100px_rgba(0,0,0,.4)]">
      <Canvas
        dpr={[1, 1.6]}
        camera={{ position: [0, 7.5, 17], fov: 48, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false }}
      >
        <GraphScene
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelect={(node) => setSelectedId(node.id)}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[70%] rounded-2xl border border-white/8 bg-black/45 px-3 py-2 backdrop-blur-xl">
        <div className="text-[9px] font-black uppercase tracking-[.16em] text-cyan-100/55">
          CLOUVA NETWORK 3D
        </div>
        <div className="mt-1 text-xs font-black text-white">
          {liveNodes} nodos vivos · {activeEdges} movimientos activos
        </div>
        <div className="mt-1 text-[9px] leading-relaxed text-white/35">
          Arrastrá para rotar · pellizcá para zoom · tocá un nodo para abrirlo.
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap gap-1.5 rounded-xl border border-white/8 bg-black/45 p-2 backdrop-blur-xl">
        <span className="rounded-lg border border-emerald-300/15 bg-emerald-300/[.05] px-2 py-1 text-[8px] font-black text-emerald-100">
          LIVE = observado ahora
        </span>
        <span className="rounded-lg border border-white/10 bg-white/[.03] px-2 py-1 text-[8px] font-black text-white/45">
          CONOCIDO = arquitectura
        </span>
        {workspaceError ? (
          <span className="rounded-lg border border-amber-300/15 bg-amber-300/[.05] px-2 py-1 text-[8px] font-black text-amber-100">
            Workspace sin señal
          </span>
        ) : null}
      </div>

      {selected ? (
        <aside className="absolute bottom-3 right-3 z-30 w-[min(360px,calc(100%-24px))] max-h-[62%] overflow-auto rounded-2xl border border-cyan-300/15 bg-[#050a10]/94 p-4 shadow-2xl shadow-black/60 backdrop-blur-2xl">
          <div className="text-[9px] font-black uppercase tracking-[.15em] text-cyan-100/50">
            {selected.kind} · {selected.status}
          </div>
          <h2 className="mt-1 text-lg font-black tracking-[-.025em] text-white">
            {selected.label}
          </h2>
          <div className="mt-1 font-mono text-[10px] text-white/35">
            {selected.subtitle}
          </div>

          <div className="mt-3 space-y-1.5 border-t border-white/7 pt-3">
            {selected.facts.map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 text-[10px]">
                <span className="text-white/32">{label}</span>
                <strong className="max-w-[65%] break-words text-right font-semibold text-white/68">
                  {value}
                </strong>
              </div>
            ))}
          </div>

          {selected.kind === "destination" ? (
            <div className="mt-3 rounded-xl border border-emerald-300/10 bg-emerald-300/[.035] p-2.5 text-[9px] leading-relaxed text-white/45">
              Esta línea es tráfico observado desde Workspace. El nodo representa el destino de red visto por la PC; no afirma el contenido cifrado que viaja dentro.
            </div>
          ) : selected.status === "known" ? (
            <div className="mt-3 rounded-xl border border-white/8 bg-white/[.025] p-2.5 text-[9px] leading-relaxed text-white/38">
              Este nodo forma parte de la arquitectura de CLOUVA. “Conocido” no significa que tengamos telemetría viva de ese servicio en esta pantalla.
            </div>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
