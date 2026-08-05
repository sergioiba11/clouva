import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { captureRef } from "react-native-view-shot";
import * as WebBrowser from "expo-web-browser";
import * as ExpoLinking from "expo-linking";
import * as Application from "expo-application";
import type { Session } from "@supabase/supabase-js";
import {
  adminFetch,
  compareVersions,
  deviceEvidence,
  downloadAndInstallRelease,
  type FlowDefinition,
  type IssueRow,
  type Overview,
  type PreviewPersona,
  type ProcessRow,
  type ReleaseRow,
  type ScreenDefinition,
  previewUrl,
  supabase,
} from "./src/lib";

WebBrowser.maybeCompleteAuthSession();

const COLORS = {
  background: "#07060d",
  panel: "#100d1c",
  panel2: "#171126",
  border: "rgba(191,164,255,0.18)",
  violet: "#8b5cf6",
  violetSoft: "#c4b5fd",
  text: "#f8f7ff",
  muted: "#a29bb3",
  green: "#6ee7b7",
  red: "#fca5a5",
  amber: "#fcd34d",
};

const PERSONAS: Array<{ id: PreviewPersona; label: string }> = [
  { id: "visitante", label: "Visitante" },
  { id: "usuario_nuevo", label: "Nuevo" },
  { id: "free", label: "Free" },
  { id: "vip", label: "VIP" },
  { id: "creador", label: "Creador" },
  { id: "miembro_estudio", label: "Miembro" },
  { id: "manager_estudio", label: "Manager" },
  { id: "owner_estudio", label: "Owner" },
  { id: "admin", label: "Admin" },
];

const TABS = [
  { id: "map", label: "Mapa", glyph: "⌘" },
  { id: "preview", label: "Probar", glyph: "▣" },
  { id: "processes", label: "Procesos", glyph: "↻" },
  { id: "issues", label: "Problemas", glyph: "!" },
  { id: "system", label: "Sistema", glyph: "⚙" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Badge({ children, tone = "violet" }: { children: React.ReactNode; tone?: "violet" | "green" | "red" | "amber" }) {
  const color = tone === "green" ? COLORS.green : tone === "red" ? COLORS.red : tone === "amber" ? COLORS.amber : COLORS.violetSoft;
  return <View style={[styles.badge, { borderColor: `${color}55`, backgroundColor: `${color}16` }]}><Text style={[styles.badgeText, { color }]}>{children}</Text></View>;
}

function Button({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled, pressed && !disabled && { opacity: 0.75 }]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function parseOAuthTokens(url: string) {
  const parsed = new URL(url);
  const query = new URLSearchParams(parsed.search);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  return {
    accessToken: hash.get("access_token") ?? query.get("access_token"),
    refreshToken: hash.get("refresh_token") ?? query.get("refresh_token"),
  };
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) Alert.alert("No se pudo entrar", result.error.message);
  }

  async function signInGoogle() {
    setBusy(true);
    try {
      const redirectTo = ExpoLinking.createURL("auth/callback");
      const oauth = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (oauth.error || !oauth.data.url) throw oauth.error ?? new Error("Supabase no entregó la URL de Google");
      const result = await WebBrowser.openAuthSessionAsync(oauth.data.url, redirectTo);
      if (result.type !== "success" || !result.url) return;
      const tokens = parseOAuthTokens(result.url);
      if (!tokens.accessToken || !tokens.refreshToken) throw new Error("Google no devolvió la sesión completa");
      const sessionResult = await supabase.auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
      if (sessionResult.error) throw sessionResult.error;
    } catch (error) {
      Alert.alert("No se pudo entrar con Google", error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.loginSafe}>
      <View style={styles.loginGlow} />
      <View style={styles.loginBox}>
        <View style={styles.appMark}><Text style={styles.appMarkText}>C</Text></View>
        <Text style={styles.loginTitle}>CLOUVA CONTROL</Text>
        <Text style={styles.loginSubtitle}>Consola Android privada para dirigir, probar y revisar CLOUVA desde el celular.</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email administrador" placeholderTextColor="#716a80" style={styles.input} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" placeholderTextColor="#716a80" style={styles.input} />
        <Button label={busy ? "Entrando..." : "Entrar"} onPress={() => void signIn()} disabled={busy || !email || !password} />
        <Button label="Continuar con Google" onPress={() => void signInGoogle()} secondary disabled={busy} />
        <Text style={styles.loginFoot}>El backend vuelve a validar tu rol real. La app no contiene claves administrativas.</Text>
      </View>
    </SafeAreaView>
  );
}

function Header({ overview, refresh, refreshing }: { overview: Overview | null; refresh: () => void; refreshing: boolean }) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.eyebrow}>CENTRO DE CONTROL MÓVIL</Text>
        <Text style={styles.headerTitle}>CLOUVA CONTROL</Text>
        <Text style={styles.headerMeta}>{overview ? `${overview.screens.length} pantallas · ${overview.processes.length} procesos` : "Conectando con CLOUVA"}</Text>
      </View>
      <Pressable onPress={refresh} style={styles.refreshButton}><Text style={styles.refreshText}>{refreshing ? "…" : "↻"}</Text></Pressable>
    </View>
  );
}

function MapScreen({ overview, onOpen }: { overview: Overview; onOpen: (screen: ScreenDefinition) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, ScreenDefinition[]>();
    for (const screen of overview.screens) map.set(screen.module, [...(map.get(screen.module) ?? []), screen]);
    return [...map.entries()];
  }, [overview.screens]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.sectionTitle}>Toda la aplicación</Text>
        <Text style={styles.sectionText}>Entrá a cualquier área sin recordar rutas y abrila directamente en la vista real.</Text>
      </Card>
      {groups.map(([module, screens]) => (
        <View key={module} style={styles.group}>
          <Text style={styles.groupTitle}>{module}</Text>
          {screens.map((screen) => (
            <Pressable key={screen.id} onPress={() => onOpen(screen)} style={styles.screenRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowLine}><Text style={styles.screenName}>{screen.name}</Text><Badge tone={screen.status === "active" ? "green" : "violet"}>{screen.status}</Badge></View>
                <Text style={styles.route}>{screen.route}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      ))}
      <Text style={styles.groupTitle}>Recorridos</Text>
      {overview.flows.map((flow) => <FlowCard key={flow.id} flow={flow} onOpen={(route) => onOpen({ id: flow.id, name: flow.name, route, module: "Recorridos", status: "active", allowedRoles: [], previewStates: PERSONAS.map((p) => p.id), enabled: true })} />)}
    </ScrollView>
  );
}

function FlowCard({ flow, onOpen }: { flow: FlowDefinition; onOpen: (route: string) => void }) {
  return (
    <Card>
      <Text style={styles.cardTitle}>{flow.name}</Text>
      <Text style={styles.sectionText}>{flow.description}</Text>
      <View style={{ marginTop: 12 }}>
        {flow.steps.map((step, index) => (
          <Pressable key={`${flow.id}-${step.route}-${index}`} onPress={() => onOpen(step.route)} style={styles.flowStep}>
            <Text style={styles.flowNumber}>{index + 1}</Text>
            <View style={{ flex: 1 }}><Text style={styles.flowLabel}>{step.label}</Text><Text style={styles.flowExpected}>{step.expected}</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function PreviewScreen({ session, screen, persona, setPersona, onReport }: { session: Session; screen: ScreenDefinition | null; persona: PreviewPersona; setPersona: (persona: PreviewPersona) => void; onReport: () => void }) {
  const webRef = useRef<WebView>(null);
  const containerRef = useRef<View>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const uri = previewUrl(session, screen?.route ?? "/matrix", persona);

  return (
    <View style={styles.previewRoot}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.personas}>
        {PERSONAS.map((item) => <Pressable key={item.id} onPress={() => setPersona(item.id)} style={[styles.persona, persona === item.id && styles.personaActive]}><Text style={[styles.personaText, persona === item.id && { color: "white" }]}>{item.label}</Text></Pressable>)}
      </ScrollView>
      <View style={styles.previewToolbar}>
        <View style={{ flex: 1 }}><Text style={styles.previewTitle}>{screen?.name ?? "La Matrix"}</Text><Text style={styles.route}>{screen?.route ?? "/matrix"}</Text></View>
        <Pressable onPress={() => webRef.current?.goBack()} style={styles.toolButton}><Text style={styles.toolText}>‹</Text></Pressable>
        <Pressable onPress={() => setReloadKey((value) => value + 1)} style={styles.toolButton}><Text style={styles.toolText}>↻</Text></Pressable>
        <Pressable onPress={onReport} style={[styles.toolButton, { borderColor: "rgba(252,165,165,.35)" }]}><Text style={[styles.toolText, { color: COLORS.red }]}>!</Text></Pressable>
      </View>
      <View ref={containerRef} collapsable={false} style={styles.webContainer}>
        <WebView key={`${uri}-${reloadKey}`} ref={webRef} source={{ uri }} sharedCookiesEnabled thirdPartyCookiesEnabled javaScriptEnabled domStorageEnabled cacheEnabled allowsBackForwardNavigationGestures setSupportMultipleWindows={false} style={styles.webview} />
      </View>
    </View>
  );
}

function ProcessesScreen({ rows }: { rows: ProcessRow[] }) {
  return (
    <FlatList data={rows} keyExtractor={(item) => `${item.source}-${item.id}`} contentContainerStyle={styles.content} ListHeaderComponent={<Card><Text style={styles.sectionTitle}>Procesos reales</Text><Text style={styles.sectionText}>Jobs de avatar, IA, importaciones, pagos, suscripciones y servicios leídos desde Supabase.</Text></Card>} renderItem={({ item }) => (
      <Card>
        <View style={styles.rowLine}><Text style={styles.cardTitle}>{item.label}</Text><Badge tone={item.status.includes("fail") || item.status.includes("error") ? "red" : item.status.includes("complete") || item.status.includes("paid") ? "green" : "amber"}>{item.status}</Badge></View>
        <Text style={styles.route}>{item.source} · {item.id}</Text>
        {item.progress != null ? <View style={styles.progressTrack}><View style={[styles.progressBar, { width: `${Math.max(0, Math.min(100, item.progress))}%` }]} /></View> : null}
        {item.error ? <Text style={styles.errorText}>{item.error}</Text> : null}
        <Text style={styles.timestamp}>{item.createdAt ? new Date(item.createdAt).toLocaleString("es-AR") : "Sin fecha"}</Text>
      </Card>
    )} />
  );
}

function IssuesScreen({ issues, onNew }: { issues: IssueRow[]; onNew: () => void }) {
  return (
    <FlatList data={issues} keyExtractor={(item) => item.id} contentContainerStyle={styles.content} ListHeaderComponent={<View style={{ gap: 12 }}><Card><Text style={styles.sectionTitle}>Problemas registrados</Text><Text style={styles.sectionText}>Cada reporte conserva ruta, persona, dispositivo, versión y evidencia visual.</Text></Card><Button label="Registrar problema" onPress={onNew} /></View>} renderItem={({ item }) => (
      <Card>
        <View style={styles.rowLine}><Text style={styles.cardTitle}>{item.title}</Text><Badge tone={item.priority === "critica" || item.priority === "alta" ? "red" : "amber"}>{item.priority}</Badge></View>
        {item.description ? <Text style={styles.sectionText}>{item.description}</Text> : null}
        <Text style={styles.route}>{item.route ?? "Sin ruta"} · {item.preview_persona ?? "sin persona"}</Text>
        <Text style={styles.timestamp}>{item.status} · {new Date(item.created_at).toLocaleString("es-AR")}</Text>
      </Card>
    )} />
  );
}

function SystemScreen({ releases, onInstall, installing }: { releases: ReleaseRow[]; onInstall: (release: ReleaseRow) => void; installing: string | null }) {
  const currentVersion = Application.nativeApplicationVersion ?? "dev";
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.sectionTitle}>Sistema Android</Text>
        <Text style={styles.sectionText}>Instalada: v{currentVersion}</Text>
        <Text style={styles.route}>com.clouva.control</Text>
      </Card>
      {releases.map((release) => (
        <Card key={release.id}>
          <View style={styles.rowLine}><Text style={styles.cardTitle}>v{release.version}</Text>{release.is_stable ? <Badge tone="green">estable</Badge> : <Badge>histórica</Badge>}</View>
          <Text style={styles.sectionText}>{release.release_notes ?? "Sin notas de versión"}</Text>
          <Text style={styles.route}>build {release.build_number} · mínimo {release.minimum_required ?? "sin bloqueo"}</Text>
          <Button label={installing === release.id ? "Descargando..." : "Descargar e instalar"} onPress={() => onInstall(release)} disabled={installing != null} />
        </Card>
      ))}
      <Button label="Cerrar sesión" onPress={() => void supabase.auth.signOut()} secondary />
    </ScrollView>
  );
}

function IssueModal({ visible, close, submit, defaultRoute }: { visible: boolean; close: () => void; submit: (data: { title: string; description: string; priority: string }) => Promise<void>; defaultRoute: string | null }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("media");
  const [busy, setBusy] = useState(false);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.modalBackdrop}><SafeAreaView style={styles.modalSheet}>
        <Text style={styles.sectionTitle}>Registrar problema</Text>
        <Text style={styles.route}>{defaultRoute ?? "Sin ruta seleccionada"}</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="Qué está mal" placeholderTextColor="#716a80" style={styles.input} />
        <TextInput value={description} onChangeText={setDescription} placeholder="Qué esperabas que sucediera" placeholderTextColor="#716a80" multiline style={[styles.input, { minHeight: 110, textAlignVertical: "top" }]} />
        <View style={styles.priorityRow}>{["baja", "media", "alta", "critica"].map((item) => <Pressable key={item} onPress={() => setPriority(item)} style={[styles.persona, priority === item && styles.personaActive]}><Text style={styles.personaText}>{item}</Text></Pressable>)}</View>
        <Button label={busy ? "Guardando..." : "Guardar con captura"} onPress={() => { setBusy(true); void submit({ title, description, priority }).finally(() => { setBusy(false); setTitle(""); setDescription(""); }); }} disabled={busy || !title.trim()} />
        <Button label="Cancelar" onPress={close} secondary disabled={busy} />
      </SafeAreaView></View>
    </Modal>
  );
}

function ControlApp({ session }: { session: Session }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>("map");
  const [selectedScreen, setSelectedScreen] = useState<ScreenDefinition | null>(null);
  const [persona, setPersona] = useState<PreviewPersona>("admin");
  const [issueOpen, setIssueOpen] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const previewCaptureRef = useRef<View>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await adminFetch<Overview>("/api/admin/clouva-control/overview");
      setOverview(data);
      if (!selectedScreen) setSelectedScreen(data.screens.find((screen) => screen.id === "matrix") ?? data.screens[0] ?? null);
    } catch (error) {
      Alert.alert("CLOUVA CONTROL", error instanceof Error ? error.message : "No se pudo cargar el sistema");
    } finally {
      setRefreshing(false);
    }
  }, [selectedScreen]);

  useEffect(() => { void load(); }, []);

  const latest = overview?.releases.find((release) => release.is_stable) ?? overview?.releases[0] ?? null;
  const currentVersion = Application.nativeApplicationVersion ?? "0.0.0";
  const mandatory = latest?.minimum_required && compareVersions(currentVersion, latest.minimum_required) < 0 ? latest : null;

  async function install(release: ReleaseRow) {
    setInstalling(release.id);
    try { await downloadAndInstallRelease(release); } catch (error) { Alert.alert("No se pudo instalar", error instanceof Error ? error.message : "Error desconocido"); } finally { setInstalling(null); }
  }

  async function submitIssue(data: { title: string; description: string; priority: string }) {
    let screenshotBase64: string | null = null;
    if (tab === "preview" && previewCaptureRef.current) {
      try { screenshotBase64 = await captureRef(previewCaptureRef, { format: "jpg", quality: 0.72, result: "base64" }); } catch { screenshotBase64 = null; }
    }
    const evidence = deviceEvidence();
    await adminFetch("/api/admin/clouva-control/issues", {
      method: "POST",
      body: JSON.stringify({ ...data, module: selectedScreen?.module ?? null, route: selectedScreen?.route ?? null, previewPersona: persona, screenshotBase64, screenshotMime: "image/jpeg", ...evidence }),
    });
    setIssueOpen(false);
    await load();
  }

  if (!overview) return <View style={styles.loading}><ActivityIndicator size="large" color={COLORS.violet} /><Text style={styles.sectionText}>Leyendo CLOUVA...</Text></View>;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Header overview={overview} refresh={() => void load()} refreshing={refreshing} />
      <View style={styles.main}>
        {tab === "map" ? <MapScreen overview={overview} onOpen={(screen) => { setSelectedScreen(screen); setTab("preview"); }} /> : null}
        {tab === "preview" ? <View ref={previewCaptureRef} collapsable={false} style={{ flex: 1 }}><PreviewScreen session={session} screen={selectedScreen} persona={persona} setPersona={setPersona} onReport={() => setIssueOpen(true)} /></View> : null}
        {tab === "processes" ? <ProcessesScreen rows={overview.processes} /> : null}
        {tab === "issues" ? <IssuesScreen issues={overview.issues} onNew={() => setIssueOpen(true)} /> : null}
        {tab === "system" ? <SystemScreen releases={overview.releases} onInstall={(release) => void install(release)} installing={installing} /> : null}
      </View>
      <View style={styles.bottomNav}>{TABS.map((item) => <Pressable key={item.id} onPress={() => setTab(item.id)} style={styles.tab}><Text style={[styles.tabGlyph, tab === item.id && styles.tabActive]}>{item.glyph}</Text><Text style={[styles.tabLabel, tab === item.id && styles.tabActive]}>{item.label}</Text></Pressable>)}</View>
      <IssueModal visible={issueOpen} close={() => setIssueOpen(false)} submit={submitIssue} defaultRoute={selectedScreen?.route ?? null} />
      <Modal visible={Boolean(mandatory)} transparent animationType="fade">
        <View style={styles.modalBackdrop}><View style={styles.blockUpdate}><Text style={styles.sectionTitle}>Actualización obligatoria</Text><Text style={styles.sectionText}>Esta instalación es v{currentVersion}. CLOUVA CONTROL requiere como mínimo v{mandatory?.minimum_required}.</Text>{mandatory ? <Button label={installing ? "Descargando..." : `Instalar v${mandatory.version}`} onPress={() => void install(mandatory)} disabled={Boolean(installing)} /> : null}</View></View>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then((result) => setSession(result.data.session ?? null));
    const subscription = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.data.subscription.unsubscribe();
  }, []);
  return <SafeAreaProvider>{session === undefined ? <View style={styles.loading}><ActivityIndicator color={COLORS.violet} /></View> : session ? <ControlApp session={session} /> : <LoginScreen />}</SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  loginSafe: { flex: 1, backgroundColor: COLORS.background, justifyContent: "center", padding: 22, overflow: "hidden" },
  loginGlow: { position: "absolute", width: 360, height: 360, borderRadius: 999, backgroundColor: "rgba(124,58,237,.2)", top: -140, right: -150 },
  loginBox: { gap: 14, backgroundColor: "rgba(16,13,28,.94)", borderWidth: 1, borderColor: COLORS.border, borderRadius: 30, padding: 24 },
  appMark: { width: 64, height: 64, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.violet, shadowColor: COLORS.violet, shadowOpacity: .5, shadowRadius: 24 },
  appMarkText: { color: "white", fontSize: 32, fontWeight: "900" },
  loginTitle: { color: COLORS.text, fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  loginSubtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 5 },
  loginFoot: { color: "#777083", textAlign: "center", fontSize: 11, lineHeight: 16, marginTop: 4 },
  input: { color: COLORS.text, backgroundColor: "rgba(255,255,255,.045)", borderWidth: 1, borderColor: "rgba(255,255,255,.1)", borderRadius: 15, minHeight: 52, paddingHorizontal: 15, paddingVertical: 13 },
  button: { minHeight: 50, borderRadius: 16, backgroundColor: COLORS.violet, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 4 },
  buttonSecondary: { backgroundColor: "rgba(255,255,255,.055)", borderWidth: 1, borderColor: "rgba(255,255,255,.12)" },
  buttonText: { color: "white", fontWeight: "800", fontSize: 14 },
  disabled: { opacity: .45 },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "rgba(255,255,255,.07)" },
  eyebrow: { color: COLORS.violetSoft, fontSize: 9, fontWeight: "800", letterSpacing: 1.8 },
  headerTitle: { color: COLORS.text, fontSize: 20, fontWeight: "900", letterSpacing: -.4, marginTop: 2 },
  headerMeta: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  refreshButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" },
  refreshText: { color: COLORS.violetSoft, fontSize: 21 },
  main: { flex: 1 },
  loading: { flex: 1, backgroundColor: COLORS.background, alignItems: "center", justifyContent: "center", gap: 12 },
  content: { padding: 14, paddingBottom: 32, gap: 12 },
  card: { backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border, borderRadius: 22, padding: 16, gap: 8 },
  sectionTitle: { color: COLORS.text, fontSize: 19, fontWeight: "900", letterSpacing: -.3 },
  sectionText: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: "800", flexShrink: 1 },
  group: { gap: 7 },
  groupTitle: { color: COLORS.violetSoft, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase", marginTop: 7, marginLeft: 4 },
  screenRow: { minHeight: 66, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 18, backgroundColor: COLORS.panel, borderWidth: 1, borderColor: "rgba(255,255,255,.07)", flexDirection: "row", alignItems: "center", gap: 10 },
  screenName: { color: COLORS.text, fontWeight: "800", fontSize: 14, flexShrink: 1 },
  rowLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  route: { color: "#81798e", fontSize: 11, fontFamily: "monospace", marginTop: 3 },
  chevron: { color: COLORS.violetSoft, fontSize: 27, fontWeight: "300" },
  badge: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  flowStep: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: 1, borderColor: "rgba(255,255,255,.06)", paddingVertical: 9 },
  flowNumber: { width: 28, height: 28, borderRadius: 10, backgroundColor: "rgba(139,92,246,.16)", color: COLORS.violetSoft, textAlign: "center", textAlignVertical: "center", fontWeight: "900" },
  flowLabel: { color: COLORS.text, fontWeight: "800", fontSize: 13 },
  flowExpected: { color: COLORS.muted, fontSize: 11, lineHeight: 16 },
  previewRoot: { flex: 1, backgroundColor: COLORS.background },
  personas: { gap: 7, paddingHorizontal: 12, paddingVertical: 9 },
  persona: { minHeight: 35, paddingHorizontal: 12, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.045)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  personaActive: { backgroundColor: "rgba(139,92,246,.35)", borderColor: "rgba(196,181,253,.55)" },
  personaText: { color: COLORS.muted, fontSize: 11, fontWeight: "800" },
  previewToolbar: { paddingHorizontal: 12, paddingBottom: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  previewTitle: { color: COLORS.text, fontWeight: "900", fontSize: 14 },
  toolButton: { width: 39, height: 39, borderRadius: 13, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel, alignItems: "center", justifyContent: "center" },
  toolText: { color: COLORS.violetSoft, fontSize: 20, fontWeight: "800" },
  webContainer: { flex: 1, marginHorizontal: 8, marginBottom: 7, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: COLORS.border, backgroundColor: "black" },
  webview: { flex: 1, backgroundColor: "#050409" },
  progressTrack: { height: 7, borderRadius: 999, overflow: "hidden", backgroundColor: "rgba(255,255,255,.07)", marginTop: 8 },
  progressBar: { height: "100%", borderRadius: 999, backgroundColor: COLORS.violet },
  errorText: { color: COLORS.red, fontSize: 12, lineHeight: 17 },
  timestamp: { color: "#746c80", fontSize: 10, marginTop: 3 },
  bottomNav: { minHeight: 66, flexDirection: "row", borderTopWidth: 1, borderColor: "rgba(255,255,255,.08)", backgroundColor: "#0b0812", paddingHorizontal: 5, paddingBottom: 3 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  tabGlyph: { color: "#756d82", fontSize: 17, fontWeight: "900" },
  tabLabel: { color: "#756d82", fontSize: 9, fontWeight: "800" },
  tabActive: { color: COLORS.violetSoft },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.72)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: COLORS.panel2, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: COLORS.border, padding: 20, gap: 12 },
  priorityRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  blockUpdate: { margin: 22, backgroundColor: COLORS.panel2, borderWidth: 1, borderColor: "rgba(252,211,77,.28)", borderRadius: 26, padding: 22, gap: 13 },
});
