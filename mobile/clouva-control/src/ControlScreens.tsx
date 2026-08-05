import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  IncidentRow,
  IssueRow,
  NormalizedStatus,
  Overview,
  ProcessRow,
  ReleaseRow,
  ScreenDefinition,
  ServiceHealth,
} from "./lib";

export const C = {
  bg: "#06050b",
  panel: "#100d1c",
  panel2: "#171126",
  panel3: "#0c1020",
  border: "rgba(191,164,255,0.18)",
  violet: "#8b5cf6",
  violetSoft: "#c4b5fd",
  blue: "#60a5fa",
  cyan: "#67e8f9",
  text: "#f8f7ff",
  muted: "#a29bb3",
  dim: "#756d82",
  green: "#6ee7b7",
  red: "#fca5a5",
  amber: "#fcd34d",
  gray: "#8b8794",
};

export type PrimaryTab = "home" | "map" | "processes" | "issues" | "system";

export const PRIMARY_TABS: Array<{ id: PrimaryTab; label: string; glyph: string }> = [
  { id: "home", label: "Inicio", glyph: "◆" },
  { id: "map", label: "Mapa", glyph: "⌘" },
  { id: "processes", label: "Procesos", glyph: "↻" },
  { id: "issues", label: "Problemas", glyph: "!" },
  { id: "system", label: "Sistema", glyph: "⚙" },
];

type NodeState = NormalizedStatus | "internal" | "preview";
type RealtimeState = "connecting" | "connected" | "disconnected" | "error";

type MapNode = {
  id: string;
  name: string;
  route?: string | null;
  screenId?: string;
  source?: string;
  category?: string;
  description: string;
};

type Navigate = (tab: PrimaryTab) => void;
type OpenRoute = (route: string, name?: string) => void;

function colorForStatus(status: NodeState | ServiceHealth["status"]) {
  if (status === "healthy" || status === "completed") return C.green;
  if (status === "running") return C.cyan;
  if (status === "attention") return C.amber;
  if (status === "failed") return C.red;
  if (status === "cancelled") return "#fb923c";
  if (status === "internal" || status === "preview") return C.violetSoft;
  return C.gray;
}

function statusLabel(status: NodeState | ServiceHealth["status"]) {
  const labels: Record<string, string> = {
    healthy: "FUNCIONANDO",
    running: "EN CURSO",
    attention: "ATENCIÓN",
    failed: "ERROR",
    completed: "COMPLETADO",
    cancelled: "CANCELADO",
    unknown: "SIN COMPROBAR",
    internal: "INTERNO",
    preview: "PREVIEW",
  };
  return labels[status] ?? String(status).toUpperCase();
}

function statusWeight(status: NodeState) {
  const weights: Record<NodeState, number> = {
    failed: 7,
    attention: 6,
    running: 5,
    cancelled: 4,
    unknown: 3,
    preview: 2,
    internal: 2,
    completed: 1,
    healthy: 0,
  };
  return weights[status];
}

function worstStatus(values: NodeState[]) {
  return values.reduce<NodeState>((worst, value) => statusWeight(value) > statusWeight(worst) ? value : worst, "healthy");
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "sin fecha";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "sin fecha";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

function compactId(value: string | null | undefined) {
  if (!value) return "—";
  return value.length > 15 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

export function Badge({ status, label }: { status: NodeState | ServiceHealth["status"]; label?: string }) {
  const color = colorForStatus(status);
  return (
    <View style={[s.badge, { borderColor: `${color}66`, backgroundColor: `${color}16` }]}>
      <Text style={[s.badgeText, { color }]}>{label ?? statusLabel(status)}</Text>
    </View>
  );
}

export function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.panel, style]}>{children}</View>;
}

export function PrimaryButton({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [s.button, secondary && s.buttonSecondary, disabled && s.disabled, pressed && !disabled && { opacity: 0.76 }]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function ControlHeader({ overview, refreshing, onRefresh, realtime }: { overview: Overview | null; refreshing: boolean; onRefresh: () => void; realtime: RealtimeState }) {
  const realtimeColor = realtime === "connected" ? C.green : realtime === "connecting" ? C.amber : C.red;
  return (
    <View style={s.header}>
      <View style={s.flex}>
        <Text style={s.eyebrow}>CENTRO DE CONTROL MÓVIL</Text>
        <Text style={s.headerTitle}>CLOUVA CONTROL</Text>
        <View style={s.headerStatusRow}>
          <View style={[s.liveDot, { backgroundColor: realtimeColor }]} />
          <Text style={s.headerMeta}>
            {overview ? `${overview.control.screenCount} pantallas · ${overview.control.processCount} procesos` : "Conectando"}
          </Text>
        </View>
      </View>
      <Pressable onPress={onRefresh} style={s.refresh}>
        <Text style={s.refreshText}>{refreshing ? "…" : "↻"}</Text>
      </Pressable>
    </View>
  );
}

export function BottomNav({ tab, onChange }: { tab: PrimaryTab; onChange: Navigate }) {
  return (
    <View style={s.nav}>
      {PRIMARY_TABS.map((item) => (
        <Pressable key={item.id} onPress={() => onChange(item.id)} style={s.tab}>
          <Text style={[s.tabGlyph, tab === item.id && s.active]}>{item.glyph}</Text>
          <Text style={[s.tabLabel, tab === item.id && s.active]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function StatCard({ value, label, tone = "violet" }: { value: number | string; label: string; tone?: "violet" | "green" | "amber" | "red" }) {
  const color = tone === "green" ? C.green : tone === "amber" ? C.amber : tone === "red" ? C.red : C.violetSoft;
  return (
    <View style={[s.statCard, { borderColor: `${color}38` }]}>
      <Text style={[s.statValue, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.rowBetween}>
      <Text style={s.groupTitle}>{title}</Text>
      {action && onAction ? <Pressable onPress={onAction}><Text style={s.sectionAction}>{action}</Text></Pressable> : null}
    </View>
  );
}

export function HomeScreen({ overview, navigate, openPreview, openRoute }: { overview: Overview; navigate: Navigate; openPreview: () => void; openRoute: OpenRoute }) {
  const summaryStatus: NodeState = overview.control.status === "critical" ? "failed" : overview.control.status === "attention" ? "attention" : "healthy";
  const activity = overview.activity.slice(0, 8);
  const topIncidents = overview.incidents.slice(0, 3);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Panel style={{ borderColor: `${colorForStatus(summaryStatus)}44` }}>
        <View style={s.rowBetween}>
          <View style={s.flex}>
            <Text style={s.panelKicker}>ESTADO GENERAL</Text>
            <Text style={s.heroTitle}>{overview.control.headline}</Text>
          </View>
          <Badge status={summaryStatus} />
        </View>
        <Text style={s.muted}>Actualizado {relativeTime(overview.generatedAt)}.</Text>
        <View style={s.statsGrid}>
          <StatCard value={overview.control.healthySystems} label="sistemas funcionando" tone="green" />
          <StatCard value={overview.control.attentionSystems} label="requieren atención" tone={overview.control.attentionSystems ? "amber" : "green"} />
          <StatCard value={overview.control.activeProcesses} label="procesos ahora" />
          <StatCard value={overview.control.openProblems} label="problemas abiertos" tone={overview.control.openProblems ? "red" : "green"} />
        </View>
      </Panel>

      <SectionHeader title="CONTROL DIRECTO" />
      <View style={s.quickGrid}>
        <Pressable onPress={() => navigate("map")} style={s.quickCard}>
          <Text style={s.quickIcon}>⌘</Text>
          <Text style={s.quickTitle}>Mapa vivo</Text>
          <Text style={s.small}>Ver módulos, flechas y cortes del flujo.</Text>
        </Pressable>
        <Pressable onPress={() => navigate("processes")} style={s.quickCard}>
          <Text style={s.quickIcon}>↻</Text>
          <Text style={s.quickTitle}>Procesos</Text>
          <Text style={s.small}>Qué está corriendo y en qué etapa.</Text>
        </Pressable>
        <Pressable onPress={() => navigate("issues")} style={s.quickCard}>
          <Text style={s.quickIcon}>!</Text>
          <Text style={s.quickTitle}>Problemas</Text>
          <Text style={s.small}>Errores agrupados y reportes pendientes.</Text>
        </Pressable>
        <Pressable onPress={openPreview} style={s.quickCard}>
          <Text style={s.quickIcon}>▣</Text>
          <Text style={s.quickTitle}>Probar roles</Text>
          <Text style={s.small}>Abrir CLOUVA como Free, VIP, Creator o admin.</Text>
        </Pressable>
      </View>

      <SectionHeader title="VENTAS Y PEDIDOS" action="Abrir tienda" onAction={() => openRoute("/tienda", "Tienda")} />
      <Panel>
        {overview.commerce.available ? (
          <>
            <View style={s.statsGrid}>
              <StatCard value={overview.commerce.approvedPaymentsToday} label="pagos aprobados hoy" tone="green" />
              <StatCard value={overview.commerce.pendingPayments} label="pagos pendientes" tone={overview.commerce.pendingPayments ? "amber" : "green"} />
              <StatCard value={overview.commerce.physicalOrdersToday} label="pedidos físicos hoy" />
              <StatCard value={overview.commerce.digitalDeliveriesToday} label="entregas 3D hoy" />
            </View>
            {overview.commerce.recentOrders.slice(0, 3).map((order) => (
              <View key={order.id} style={s.compactRow}>
                <View style={s.flex}>
                  <Text style={s.rowTitle}>{order.orderNumber ? `Pedido ${order.orderNumber}` : `Pedido ${compactId(order.id)}`}</Text>
                  <Text style={s.small}>{order.paymentStatus} · envío {order.shippingStatus} · {relativeTime(order.createdAt)}</Text>
                </View>
                <Text style={s.money}>{order.currency} {Math.round(order.total).toLocaleString("es-AR")}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={s.muted}>El resumen comercial se activará al aplicar la migración operativa de CLOUVA CONTROL.</Text>
        )}
      </Panel>

      <SectionHeader title="AHORA EN CLOUVA" action="Ver procesos" onAction={() => navigate("processes")} />
      <Panel>
        {activity.length === 0 ? <Text style={s.muted}>No hay actividad reciente registrada.</Text> : activity.map((event) => (
          <Pressable key={event.id} onPress={() => event.route ? openRoute(event.route, event.category) : navigate("processes")} style={s.activityRow}>
            <View style={[s.activityDot, { backgroundColor: colorForStatus(event.status) }]} />
            <View style={s.flex}>
              <Text style={s.rowTitle}>{event.title}</Text>
              <Text style={s.small}>{event.detail} · {relativeTime(event.occurredAt)}</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </Pressable>
        ))}
      </Panel>

      <SectionHeader title="REQUIERE TU ATENCIÓN" action="Ver todo" onAction={() => navigate("issues")} />
      <Panel>
        {topIncidents.length === 0 ? (
          <View style={s.emptyGood}><Text style={s.emptyGoodIcon}>✓</Text><Text style={s.rowTitle}>No hay incidentes automáticos abiertos.</Text></View>
        ) : topIncidents.map((incident) => (
          <View key={incident.fingerprint} style={s.incidentCompact}>
            <Badge status={incident.severity === "critical" ? "failed" : "attention"} />
            <View style={s.flex}>
              <Text style={s.rowTitle}>{incident.title}</Text>
              <Text style={s.small}>{incident.category} · {incident.count} afectado{incident.count === 1 ? "" : "s"} · {relativeTime(incident.lastSeen)}</Text>
            </View>
          </View>
        ))}
      </Panel>
    </ScrollView>
  );
}

const MAIN_FLOW: MapNode[] = [
  { id: "landing", screenId: "landing", name: "Entrada pública", route: "/", description: "Puerta pública de CLOUVA." },
  { id: "login", screenId: "login", name: "Login", route: "/login", description: "Autenticación y recuperación de sesión." },
  { id: "onboarding", screenId: "onboarding", name: "Onboarding", route: "/onboarding/identity", description: "Creación inicial del Player." },
  { id: "home", screenId: "home", name: "Home", route: "/home", description: "Entrada principal autenticada." },
  { id: "matrix", screenId: "matrix", name: "La Matrix", route: "/matrix", description: "Red de Players y estudios." },
  { id: "players", screenId: "players", name: "Players", route: "/players", description: "Exploración de identidades públicas." },
  { id: "perfil", screenId: "perfil", name: "Mi perfil", route: "/perfil", description: "Centro de identidad del Player." },
  { id: "profile-edit", screenId: "profile-edit", name: "Editor del Player", route: "/profile/edit", description: "Edición y publicación del Player." },
];

const BRANCHES: Array<{ id: string; title: string; nodes: MapNode[] }> = [
  {
    id: "avatar",
    title: "AVATAR Y CREATOR STUDIO",
    nodes: [
      { id: "avatar", screenId: "avatar", name: "Avatar", route: "/mi-flow/avatar", description: "Avatar activo del Player." },
      { id: "creator-studio", screenId: "creator-studio", name: "Creator Studio", route: "/creator-studio", description: "Creación, procesamiento e inventario." },
      { id: "avatar-analyzer", screenId: "avatar-analyzer", source: "avatar_analyzer_jobs", name: "Analizador", route: "/avatar-analyzer-v4", description: "Análisis corporal y diagnóstico." },
      { id: "inventory", category: "Avatar", name: "Inventario", route: "/creator-studio", description: "Recursos disponibles para el avatar." },
      { id: "assignment", category: "Avatar", name: "Asignación al avatar", route: "/mi-flow/avatar", description: "Aplicación del recurso al avatar activo." },
    ],
  },
  {
    id: "studios",
    title: "ESTUDIOS",
    nodes: [
      { id: "studios", screenId: "studios", name: "Estudios", route: "/studios", description: "Exploración de estudios públicos." },
      { id: "studio-public", screenId: "studio-public", name: "Página pública", route: "/studios/iglu", description: "Identidad, Players y propuesta del estudio." },
      { id: "studio-join", screenId: "studio-join", name: "Unirse", route: "/studios/iglu/join", description: "Creación de membresía gratuita." },
      { id: "studio-dashboard", screenId: "studio-dashboard", name: "Panel del estudio", route: "/studio-dashboard", description: "Administración de miembros, contenido y ventas." },
      { id: "studio-merch", category: "Pedidos físicos", name: "Merch del estudio", route: "/tienda", description: "Merch oficial del estudio dentro del mismo motor comercial." },
    ],
  },
  {
    id: "marketplace",
    title: "MARKETPLACE",
    nodes: [
      { id: "tienda", screenId: "tienda", name: "Tienda", route: "/tienda", description: "Merch oficial, de usuarios y de estudios." },
      { id: "product", category: "Pedidos físicos", name: "Producto", route: "/tienda", description: "Producto físico o digital 3D." },
      { id: "checkout", screenId: "checkout", name: "Checkout", route: "/checkout", description: "Creación del pedido y validación de stock." },
      { id: "mercado-pago", source: "billing_payments", name: "Mercado Pago", route: "/checkout", description: "Pago único y confirmación por webhook." },
      { id: "order", source: "store_orders", name: "Pedido", route: "/tienda", description: "Seguimiento del pedido real." },
      { id: "production", category: "Pedidos físicos", name: "Producción", route: "/admin", description: "Preparación, producción y empaquetado." },
      { id: "shipping", category: "Pedidos físicos", name: "Envío físico", route: "/admin", description: "Despacho, camino y entrega." },
      { id: "digital-delivery", category: "Avatar", name: "Entrega digital 3D", route: "/creator-studio", description: "Inventario y asignación automática al avatar." },
    ],
  },
  {
    id: "admin",
    title: "ADMINISTRACIÓN",
    nodes: [
      { id: "admin", screenId: "admin", name: "Centro de Control", route: "/admin", description: "Administración web general." },
      { id: "clouva-control", screenId: "clouva-control", name: "CLOUVA CONTROL", route: "/admin/clouva-control", description: "Cabina móvil y APIs administrativas." },
    ],
  },
];

function processMatchesNode(process: ProcessRow, node: MapNode) {
  if (node.source && process.source === node.source) return true;
  if (node.category && process.category === node.category) return true;
  if (node.route && process.route === node.route) return true;
  return false;
}

function nodeInfo(node: MapNode, overview: Overview) {
  const screen = node.screenId ? overview.screens.find((candidate) => candidate.id === node.screenId) ?? null : null;
  const related = overview.processes.filter((process) => processMatchesNode(process, node));
  const issues = overview.issues.filter((issue) => issue.status !== "resuelto" && node.route && issue.route === node.route);
  const states: NodeState[] = related
    .filter((process) => process.activityState !== "history")
    .map((process) => process.normalizedStatus);
  if (issues.length > 0) states.push("failed");
  if (states.length === 0) {
    if (screen?.status === "internal") states.push("internal");
    else if (screen?.status === "preview") states.push("preview");
    else if (screen?.status === "active") states.push("healthy");
    else states.push("unknown");
  }
  const latest = related
    .slice()
    .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))[0] ?? null;
  return {
    state: worstStatus(states),
    screen,
    related,
    issues,
    latest,
  };
}

function FlowConnector({ status }: { status: NodeState }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (status !== "running") {
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse, status]);
  const color = colorForStatus(status);
  const dotted = status === "unknown";
  return (
    <View style={s.connectorWrap}>
      <View style={[s.connectorLine, { backgroundColor: dotted ? "transparent" : `${color}99`, borderColor: color, borderStyle: dotted ? "dashed" : "solid" }]} />
      <Animated.Text style={[s.connectorArrow, { color, opacity: status === "running" ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) : 1 }]}>▼</Animated.Text>
    </View>
  );
}

function MapNodeCard({ node, overview, onPress }: { node: MapNode; overview: Overview; onPress: () => void }) {
  const info = nodeInfo(node, overview);
  const color = colorForStatus(info.state);
  return (
    <Pressable onPress={onPress} style={[s.mapNode, { borderColor: `${color}55`, shadowColor: color }]}>
      <View style={s.rowBetween}>
        <View style={s.flex}>
          <Text style={s.mapNodeTitle}>{node.name}</Text>
          {node.route ? <Text style={s.code}>{node.route}</Text> : null}
        </View>
        <Badge status={info.state} />
      </View>
      <View style={s.nodeMetaRow}>
        <Text style={s.small}>{info.related.length} actividad{info.related.length === 1 ? "" : "es"}</Text>
        <Text style={s.small}>{info.issues.length} error{info.issues.length === 1 ? "" : "es"}</Text>
        <Text style={s.small}>{info.latest ? relativeTime(info.latest.updatedAt ?? info.latest.createdAt) : "sin actividad"}</Text>
      </View>
    </Pressable>
  );
}

function NodeSheet({ node, overview, close, openRoute, navigate }: { node: MapNode | null; overview: Overview; close: () => void; openRoute: OpenRoute; navigate: Navigate }) {
  if (!node) return null;
  const info = nodeInfo(node, overview);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={s.backdrop}>
        <SafeAreaView style={s.sheet}>
          <View style={s.sheetHandle} />
          <View style={s.rowBetween}>
            <View style={s.flex}>
              <Text style={s.panelKicker}>MAPA OPERATIVO</Text>
              <Text style={s.sheetTitle}>{node.name}</Text>
            </View>
            <Badge status={info.state} />
          </View>
          <Text style={s.muted}>{node.description}</Text>
          {node.route ? <Text style={s.code}>{node.route}</Text> : null}
          <View style={s.detailGrid}>
            <View style={s.detailCell}><Text style={s.detailValue}>{info.related.length}</Text><Text style={s.small}>procesos relacionados</Text></View>
            <View style={s.detailCell}><Text style={s.detailValue}>{info.issues.length}</Text><Text style={s.small}>problemas abiertos</Text></View>
          </View>
          <Text style={s.groupTitle}>ACTIVIDAD RECIENTE</Text>
          {info.related.slice(0, 4).map((process) => (
            <View key={`${process.source}-${process.id}`} style={s.compactRow}>
              <View style={[s.activityDot, { backgroundColor: colorForStatus(process.normalizedStatus) }]} />
              <View style={s.flex}><Text style={s.rowTitle}>{process.humanMessage}</Text><Text style={s.small}>{process.currentStage} · {relativeTime(process.updatedAt ?? process.createdAt)}</Text></View>
            </View>
          ))}
          {info.related.length === 0 ? <Text style={s.muted}>No hay procesos recientes vinculados a este nodo.</Text> : null}
          <View style={s.sheetActions}>
            {node.route ? <PrimaryButton label="Abrir área" onPress={() => { close(); openRoute(node.route ?? "/matrix", node.name); }} /> : null}
            <PrimaryButton label="Ver procesos" onPress={() => { close(); navigate("processes"); }} secondary />
            <PrimaryButton label="Cerrar" onPress={close} secondary />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function OperationalMapScreen({ overview, openRoute, navigate }: { overview: Overview; openRoute: OpenRoute; navigate: Navigate }) {
  const [selected, setSelected] = useState<MapNode | null>(null);
  return (
    <>
      <ScrollView contentContainerStyle={s.content}>
        <Panel>
          <View style={s.rowBetween}><View style={s.flex}><Text style={s.sectionTitle}>Mapa de la aplicación</Text><Text style={s.muted}>Las flechas y nodos se calculan con actividad, errores y estados reales.</Text></View><Badge status="running" label="EN VIVO" /></View>
        </Panel>

        <SectionHeader title="FLUJO PRINCIPAL" />
        <View style={s.mapColumn}>
          {MAIN_FLOW.map((node, index) => {
            const info = nodeInfo(node, overview);
            const next = MAIN_FLOW[index + 1];
            const nextInfo = next ? nodeInfo(next, overview) : null;
            const connectorStatus = nextInfo ? worstStatus([info.state, nextInfo.state]) : "healthy";
            return (
              <React.Fragment key={node.id}>
                <MapNodeCard node={node} overview={overview} onPress={() => setSelected(node)} />
                {next ? <FlowConnector status={connectorStatus} /> : null}
              </React.Fragment>
            );
          })}
        </View>

        <View style={s.branchOrigin}>
          <Text style={s.branchOriginLine}>╱</Text><Text style={s.branchOriginText}>RAMAS DESDE MI PERFIL</Text><Text style={s.branchOriginLine}>╲</Text>
        </View>

        {BRANCHES.map((branch) => (
          <View key={branch.id} style={s.branchPanel}>
            <Text style={s.groupTitle}>{branch.title}</Text>
            {branch.nodes.map((node, index) => {
              const info = nodeInfo(node, overview);
              const next = branch.nodes[index + 1];
              const nextInfo = next ? nodeInfo(next, overview) : null;
              return (
                <React.Fragment key={node.id}>
                  <MapNodeCard node={node} overview={overview} onPress={() => setSelected(node)} />
                  {next ? <FlowConnector status={nextInfo ? worstStatus([info.state, nextInfo.state]) : info.state} /> : null}
                </React.Fragment>
              );
            })}
          </View>
        ))}

        <SectionHeader title="RECORRIDOS GUIADOS" />
        {overview.flows.map((flow) => (
          <Panel key={flow.id}>
            <Text style={s.cardTitle}>{flow.name}</Text>
            <Text style={s.muted}>{flow.description}</Text>
            {flow.steps.map((step, index) => (
              <Pressable key={`${flow.id}-${step.label}-${index}`} onPress={() => openRoute(step.route, step.label)} style={s.flowStep}>
                <View style={s.flowNumber}><Text style={s.flowNumberText}>{index + 1}</Text></View>
                <View style={s.flex}><Text style={s.rowTitle}>{step.label}</Text><Text style={s.small}>{step.expected}</Text></View>
                <Text style={s.chevron}>›</Text>
              </Pressable>
            ))}
          </Panel>
        ))}
      </ScrollView>
      <NodeSheet node={selected} overview={overview} close={() => setSelected(null)} openRoute={openRoute} navigate={navigate} />
    </>
  );
}

const PROCESS_FILTERS = [
  { id: "now", label: "Ahora" },
  { id: "running", label: "En progreso" },
  { id: "attention", label: "Necesitan atención" },
  { id: "completed", label: "Completados" },
  { id: "cancelled", label: "Cancelados" },
  { id: "history", label: "Historial" },
] as const;

type ProcessFilter = (typeof PROCESS_FILTERS)[number]["id"];

function ProcessCard({ process, openRoute }: { process: ProcessRow; openRoute: OpenRoute }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Panel>
      <View style={s.rowBetween}>
        <View style={s.flex}>
          <Text style={s.cardTitle}>{process.label}</Text>
          <Text style={s.muted}>{process.humanMessage}</Text>
        </View>
        <Badge status={process.normalizedStatus} />
      </View>
      <Text style={s.stage}>{process.currentStage ?? process.status}</Text>
      {process.progress != null ? (
        <View style={s.progress}><View style={[s.progressValue, { width: `${Math.max(0, Math.min(100, process.progress))}%` }]} /></View>
      ) : null}
      <View style={s.nodeMetaRow}>
        <Text style={s.small}>{process.activityState === "now" ? "actividad actual" : process.activityState === "recent" ? "actividad reciente" : "historial"}</Text>
        <Text style={s.small}>{relativeTime(process.updatedAt ?? process.createdAt)}</Text>
      </View>
      <Pressable onPress={() => setExpanded((value) => !value)} style={s.detailsToggle}>
        <Text style={s.detailsToggleText}>{expanded ? "Ocultar detalles" : "Ver detalles"}</Text>
      </Pressable>
      {expanded ? (
        <View style={s.technicalBox}>
          <Text style={s.small}>Área: {process.affectedArea ?? "Sistema"}</Text>
          <Text style={s.small}>Usuario: {compactId(process.userId)}</Text>
          <Text style={s.small}>Recurso: {compactId(process.resourceId)}</Text>
          <Text selectable style={s.code}>Fuente: {process.source}</Text>
          {process.technicalMessage ? <Text selectable style={s.error}>{process.technicalMessage}</Text> : <Text style={s.small}>Sin error técnico asociado.</Text>}
        </View>
      ) : null}
      {process.route ? <PrimaryButton label="Abrir área afectada" onPress={() => openRoute(process.route ?? "/matrix", process.label)} secondary /> : null}
    </Panel>
  );
}

export function ProcessesScreen({ processes, openRoute }: { processes: ProcessRow[]; openRoute: OpenRoute }) {
  const [filter, setFilter] = useState<ProcessFilter>("now");
  const visible = useMemo(() => processes.filter((process) => {
    if (filter === "now") return process.activityState === "now";
    if (filter === "running") return process.normalizedStatus === "running";
    if (filter === "attention") return ["attention", "failed"].includes(process.normalizedStatus);
    if (filter === "completed") return process.normalizedStatus === "completed";
    if (filter === "cancelled") return process.normalizedStatus === "cancelled";
    return process.activityState === "history";
  }), [filter, processes]);

  const groups = useMemo(() => {
    const result = new Map<string, ProcessRow[]>();
    for (const process of visible) result.set(process.category, [...(result.get(process.category) ?? []), process]);
    return [...result.entries()];
  }, [visible]);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Panel><Text style={s.sectionTitle}>Procesos reales</Text><Text style={s.muted}>Actividad actual separada del historial y traducida a lenguaje humano.</Text></Panel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
        {PROCESS_FILTERS.map((item) => (
          <Pressable key={item.id} onPress={() => setFilter(item.id)} style={[s.filterChip, filter === item.id && s.filterChipActive]}>
            <Text style={[s.filterText, filter === item.id && s.filterTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {groups.length === 0 ? <Panel><Text style={s.muted}>No hay procesos dentro de este filtro.</Text></Panel> : groups.map(([category, rows]) => (
        <View key={category} style={s.groupBlock}>
          <SectionHeader title={`${category} · ${rows.length}`} />
          {rows.map((process) => <ProcessCard key={`${process.source}-${process.id}`} process={process} openRoute={openRoute} />)}
        </View>
      ))}
    </ScrollView>
  );
}

function IncidentCard({ incident, openRoute }: { incident: IncidentRow; openRoute: OpenRoute }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Panel style={{ borderColor: incident.severity === "critical" ? "rgba(252,165,165,.32)" : "rgba(252,211,77,.28)" }}>
      <View style={s.rowBetween}><Text style={s.cardTitle}>{incident.title}</Text><Badge status={incident.severity === "critical" ? "failed" : "attention"} /></View>
      <Text style={s.muted}>{incident.summary}</Text>
      <View style={s.detailGrid}>
        <View style={s.detailCell}><Text style={s.detailValue}>{incident.count}</Text><Text style={s.small}>afectados</Text></View>
        <View style={s.detailCell}><Text style={s.detailValue}>{incident.affectedUsers.length}</Text><Text style={s.small}>usuarios</Text></View>
      </View>
      <Text style={s.small}>Primera aparición: {relativeTime(incident.firstSeen)} · última: {relativeTime(incident.lastSeen)}</Text>
      <Pressable onPress={() => setExpanded((value) => !value)} style={s.detailsToggle}><Text style={s.detailsToggleText}>{expanded ? "Ocultar causa" : "Ver causa común"}</Text></Pressable>
      {expanded ? <View style={s.technicalBox}><Text selectable style={s.code}>{incident.source}</Text><Text selectable style={s.error}>{incident.technicalMessage ?? "No hay mensaje técnico guardado."}</Text></View> : null}
      {incident.route ? <PrimaryButton label="Abrir área afectada" onPress={() => openRoute(incident.route ?? "/matrix", incident.category)} secondary /> : null}
    </Panel>
  );
}

function IssueCard({ issue, update }: { issue: IssueRow; update: (issue: IssueRow, status: string) => void }) {
  const tone: NodeState = issue.priority === "critica" || issue.priority === "alta" ? "failed" : issue.status === "resuelto" ? "completed" : "attention";
  return (
    <Panel>
      <View style={s.rowBetween}><Text style={s.cardTitle}>{issue.title}</Text><Badge status={tone} label={issue.status.replaceAll("_", " ")} /></View>
      {issue.description ? <Text style={s.muted}>{issue.description}</Text> : null}
      <Text style={s.small}>{issue.route ?? "Sin ruta"} · prioridad {issue.priority} · {relativeTime(issue.created_at)}</Text>
      {issue.status !== "resuelto" ? (
        <View style={s.actionRow}>
          <Pressable onPress={() => update(issue, "en_revision")} style={s.smallAction}><Text style={s.smallActionText}>Marcar revisado</Text></Pressable>
          <Pressable onPress={() => update(issue, "resuelto")} style={s.smallAction}><Text style={s.smallActionText}>Resolver</Text></Pressable>
        </View>
      ) : null}
    </Panel>
  );
}

export function ProblemsScreen({ incidents, issues, createIssue, updateIssue, openRoute }: { incidents: IncidentRow[]; issues: IssueRow[]; createIssue: () => void; updateIssue: (issue: IssueRow, status: string) => void; openRoute: OpenRoute }) {
  const openIssues = issues.filter((issue) => issue.status !== "resuelto");
  const resolvedIssues = issues.filter((issue) => issue.status === "resuelto");
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Panel><Text style={s.sectionTitle}>Problemas que requieren atención</Text><Text style={s.muted}>Los fallos automáticos se agrupan por causa; los reportes manuales conservan su historial.</Text></Panel>
      <PrimaryButton label="Registrar problema" onPress={createIssue} />
      <SectionHeader title={`INCIDENTES AUTOMÁTICOS · ${incidents.length}`} />
      {incidents.length === 0 ? <Panel><View style={s.emptyGood}><Text style={s.emptyGoodIcon}>✓</Text><Text style={s.rowTitle}>No hay fallos automáticos agrupados.</Text></View></Panel> : incidents.map((incident) => <IncidentCard key={incident.fingerprint} incident={incident} openRoute={openRoute} />)}
      <SectionHeader title={`REPORTES ABIERTOS · ${openIssues.length}`} />
      {openIssues.length === 0 ? <Panel><Text style={s.muted}>No hay reportes manuales abiertos.</Text></Panel> : openIssues.map((issue) => <IssueCard key={issue.id} issue={issue} update={updateIssue} />)}
      {resolvedIssues.length > 0 ? (
        <>
          <SectionHeader title={`RESUELTOS · ${resolvedIssues.length}`} />
          {resolvedIssues.slice(0, 20).map((issue) => <IssueCard key={issue.id} issue={issue} update={updateIssue} />)}
        </>
      ) : null}
    </ScrollView>
  );
}

function serviceWithRealtime(service: ServiceHealth, realtime: RealtimeState): ServiceHealth {
  if (service.id !== "supabase-realtime") return service;
  if (realtime === "connected") return { ...service, status: "healthy", detail: "El APK mantiene un canal Realtime conectado.", lastSuccessAt: new Date().toISOString(), verification: "direct" };
  if (realtime === "connecting") return { ...service, status: "unknown", detail: "El APK está conectando el canal Realtime." };
  return { ...service, status: "attention", detail: "El canal Realtime del APK está desconectado.", recentErrors: 1, verification: "direct" };
}

function ServiceCard({ service }: { service: ServiceHealth }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Panel>
      <View style={s.rowBetween}><Text style={s.cardTitle}>{service.name}</Text><Badge status={service.status} /></View>
      <Text style={s.muted}>{service.detail}</Text>
      <Text style={s.small}>Comprobación: {service.verification === "direct" ? "directa" : service.verification === "activity" ? "por actividad real" : "no ejecutada"} · {relativeTime(service.lastCheckedAt)}</Text>
      <Pressable onPress={() => setExpanded((value) => !value)} style={s.detailsToggle}><Text style={s.detailsToggleText}>{expanded ? "Ocultar dependencias" : "Ver dependencias"}</Text></Pressable>
      {expanded ? <View style={s.technicalBox}><Text style={s.small}>Último éxito: {relativeTime(service.lastSuccessAt)}</Text><Text style={s.small}>Errores recientes: {service.recentErrors}</Text><Text style={s.small}>Dependen: {service.dependents.join(" · ")}</Text></View> : null}
    </Panel>
  );
}

export function SystemScreen({ overview, realtime, releases, install, installing, openPreview, signOut }: { overview: Overview; realtime: RealtimeState; releases: ReleaseRow[]; install: (release: ReleaseRow) => void; installing: string | null; openPreview: () => void; signOut: () => void }) {
  const services = overview.services.map((service) => serviceWithRealtime(service, realtime));
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Panel><Text style={s.sectionTitle}>Sistema y servicios</Text><Text style={s.muted}>Una integración solo figura como funcionando cuando existe una comprobación directa o actividad real.</Text></Panel>
      <PrimaryButton label="Probar CLOUVA por roles" onPress={openPreview} />
      <SectionHeader title="SERVICIOS CONECTADOS" />
      {services.map((service) => <ServiceCard key={service.id} service={service} />)}
      <SectionHeader title="VERSIONES DEL APK" />
      {releases.map((release) => (
        <Panel key={release.id}>
          <View style={s.rowBetween}><Text style={s.cardTitle}>CLOUVA CONTROL v{release.version}</Text><Badge status={release.is_stable ? "completed" : "internal"} label={release.is_stable ? "ESTABLE" : "HISTÓRICA"} /></View>
          <Text style={s.muted}>{release.release_notes ?? "Sin notas"}</Text>
          <Text style={s.small}>Build {release.build_number} · mínimo {release.minimum_required ?? "sin bloqueo"}</Text>
          <Text selectable style={s.code}>SHA-256 {release.checksum}</Text>
          <PrimaryButton label={installing === release.id ? "Descargando..." : "Descargar e instalar"} onPress={() => install(release)} disabled={installing != null} />
        </Panel>
      ))}
      <PrimaryButton label="Cerrar sesión" onPress={signOut} secondary />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 14, paddingBottom: 34, gap: 12 },
  panel: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 16, gap: 9 },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "rgba(255,255,255,.07)", backgroundColor: C.bg },
  eyebrow: { color: C.violetSoft, fontSize: 9, fontWeight: "800", letterSpacing: 1.8 },
  headerTitle: { color: C.text, fontSize: 21, fontWeight: "900" },
  headerMeta: { color: C.muted, fontSize: 11 },
  headerStatusRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 99 },
  refresh: { width: 44, height: 44, borderRadius: 15, backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  refreshText: { color: C.violetSoft, fontSize: 22 },
  nav: { minHeight: 68, flexDirection: "row", borderTopWidth: 1, borderColor: "rgba(255,255,255,.08)", backgroundColor: "#0b0812", paddingBottom: 3 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  tabGlyph: { color: C.dim, fontSize: 17, fontWeight: "900" },
  tabLabel: { color: C.dim, fontSize: 9, fontWeight: "800" },
  active: { color: C.violetSoft },
  badge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  badgeText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  button: { minHeight: 49, borderRadius: 16, backgroundColor: C.violet, alignItems: "center", justifyContent: "center", paddingHorizontal: 17, marginTop: 3 },
  buttonSecondary: { backgroundColor: "rgba(255,255,255,.055)", borderWidth: 1, borderColor: "rgba(255,255,255,.12)" },
  buttonText: { color: "white", fontWeight: "800", fontSize: 13 },
  disabled: { opacity: 0.4 },
  panelKicker: { color: C.violetSoft, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  heroTitle: { color: C.text, fontSize: 23, lineHeight: 29, fontWeight: "900", marginTop: 3 },
  sectionTitle: { color: C.text, fontSize: 20, fontWeight: "900" },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  rowTitle: { color: C.text, fontWeight: "800", fontSize: 13, flexShrink: 1 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  small: { color: "#837b91", fontSize: 10, lineHeight: 15 },
  code: { color: "#81798e", fontSize: 10, lineHeight: 15, fontFamily: "monospace", marginTop: 2 },
  error: { color: C.red, fontSize: 11, lineHeight: 17 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statCard: { width: "48%", minHeight: 78, borderRadius: 17, padding: 12, backgroundColor: "rgba(255,255,255,.035)", borderWidth: 1, justifyContent: "center" },
  statValue: { fontSize: 24, fontWeight: "900" },
  statLabel: { color: C.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  groupTitle: { color: C.violetSoft, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase", marginLeft: 3 },
  sectionAction: { color: C.cyan, fontSize: 10, fontWeight: "800" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  quickCard: { width: "48%", minHeight: 128, padding: 14, borderRadius: 20, backgroundColor: C.panel3, borderWidth: 1, borderColor: C.border, gap: 5 },
  quickIcon: { color: C.violetSoft, fontSize: 23, fontWeight: "900" },
  quickTitle: { color: C.text, fontSize: 14, fontWeight: "900" },
  compactRow: { minHeight: 53, flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, borderColor: "rgba(255,255,255,.06)", paddingVertical: 8 },
  money: { color: C.green, fontSize: 11, fontWeight: "900" },
  activityRow: { minHeight: 59, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: "rgba(255,255,255,.06)", paddingVertical: 8 },
  activityDot: { width: 9, height: 9, borderRadius: 99 },
  chevron: { color: C.violetSoft, fontSize: 25 },
  incidentCompact: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: "rgba(255,255,255,.06)", paddingVertical: 9 },
  emptyGood: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10 },
  emptyGoodIcon: { color: C.green, fontSize: 22, fontWeight: "900" },
  mapColumn: { gap: 0 },
  mapNode: { backgroundColor: C.panel, borderWidth: 1, borderRadius: 20, padding: 14, gap: 8, shadowOpacity: 0.18, shadowRadius: 10, elevation: 2 },
  mapNodeTitle: { color: C.text, fontSize: 15, fontWeight: "900" },
  nodeMetaRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  connectorWrap: { height: 39, alignItems: "center", justifyContent: "center" },
  connectorLine: { width: 2, height: 25, borderWidth: 1 },
  connectorArrow: { fontSize: 11, marginTop: -4 },
  branchOrigin: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  branchOriginLine: { color: C.violet, fontSize: 19 },
  branchOriginText: { color: C.violetSoft, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  branchPanel: { backgroundColor: "rgba(12,16,32,.7)", borderWidth: 1, borderColor: "rgba(96,165,250,.16)", borderRadius: 24, padding: 12, gap: 0 },
  flowStep: { minHeight: 59, flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: 1, borderColor: "rgba(255,255,255,.06)", paddingVertical: 9 },
  flowNumber: { width: 29, height: 29, borderRadius: 10, backgroundColor: "rgba(139,92,246,.18)", alignItems: "center", justifyContent: "center" },
  flowNumberText: { color: C.violetSoft, fontWeight: "900", fontSize: 11 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.72)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.panel2, borderTopLeftRadius: 29, borderTopRightRadius: 29, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12, maxHeight: "92%" },
  sheetHandle: { width: 48, height: 4, borderRadius: 99, backgroundColor: "rgba(255,255,255,.18)", alignSelf: "center" },
  sheetTitle: { color: C.text, fontSize: 23, fontWeight: "900" },
  detailGrid: { flexDirection: "row", gap: 9 },
  detailCell: { flex: 1, minHeight: 72, padding: 12, justifyContent: "center", borderRadius: 16, backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: "rgba(255,255,255,.07)" },
  detailValue: { color: C.text, fontSize: 21, fontWeight: "900" },
  sheetActions: { gap: 7 },
  filterRow: { gap: 7, paddingVertical: 2 },
  filterChip: { minHeight: 37, paddingHorizontal: 13, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.045)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  filterChipActive: { backgroundColor: "rgba(139,92,246,.28)", borderColor: "rgba(196,181,253,.48)" },
  filterText: { color: C.muted, fontSize: 10, fontWeight: "800" },
  filterTextActive: { color: C.text },
  groupBlock: { gap: 10 },
  stage: { color: C.cyan, fontSize: 11, fontWeight: "800" },
  progress: { height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: "rgba(255,255,255,.07)" },
  progressValue: { height: "100%", backgroundColor: C.violet },
  detailsToggle: { minHeight: 35, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "rgba(255,255,255,.035)" },
  detailsToggleText: { color: C.violetSoft, fontSize: 10, fontWeight: "800" },
  technicalBox: { gap: 5, padding: 12, borderRadius: 15, backgroundColor: "rgba(0,0,0,.22)", borderWidth: 1, borderColor: "rgba(255,255,255,.06)" },
  actionRow: { flexDirection: "row", gap: 7 },
  smallAction: { flex: 1, minHeight: 39, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(139,92,246,.13)", borderWidth: 1, borderColor: C.border },
  smallActionText: { color: C.violetSoft, fontSize: 10, fontWeight: "800" },
});
