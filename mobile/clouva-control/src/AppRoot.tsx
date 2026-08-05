import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { captureRef } from "react-native-view-shot";
import * as Application from "expo-application";
import * as ExpoLinking from "expo-linking";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import {
  AdminApiError,
  API_URL,
  adminFetch,
  compareVersions,
  deviceEvidence,
  downloadAndInstallRelease,
  type IssueRow,
  type Overview,
  type PreviewPersona,
  type ReleaseRow,
  type ScreenDefinition,
  previewUrl,
  supabase,
} from "./lib";
import {
  BottomNav,
  C,
  ControlHeader,
  HomeScreen,
  OperationalMapScreen,
  Panel,
  PrimaryButton,
  ProblemsScreen,
  ProcessesScreen,
  SystemScreen,
  type PrimaryTab,
} from "./ControlScreens";

WebBrowser.maybeCompleteAuthSession();

const PERSONAS: Array<{ id: PreviewPersona; label: string }> = [
  { id: "visitante", label: "Visitante" },
  { id: "usuario_nuevo", label: "Usuario nuevo" },
  { id: "free", label: "Player Free" },
  { id: "vip", label: "Player VIP" },
  { id: "creador", label: "Creator" },
  { id: "miembro_estudio", label: "Miembro" },
  { id: "manager_estudio", label: "Manager" },
  { id: "owner_estudio", label: "Dueño" },
  { id: "admin", label: "Administrador" },
];

type RealtimeState = "connecting" | "connected" | "disconnected" | "error";
type Attachment = { base64: string; mime: string; label: string };
type IssueDraft = { title: string; description: string; priority: string; attachment: Attachment | null };
type InspectorInfo = {
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  path: string;
  rect: { x: number; y: number; width: number; height: number };
};
type PreviewProblem = { title: string; detail: string };

function parseOAuthTokens(url: string) {
  const parsed = new URL(url);
  const search = new URLSearchParams(parsed.search);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  return {
    accessToken: hash.get("access_token") ?? search.get("access_token"),
    refreshToken: hash.get("refresh_token") ?? search.get("refresh_token"),
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

  async function google() {
    setBusy(true);
    try {
      const redirectTo = ExpoLinking.createURL("auth/callback");
      const oauth = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (oauth.error || !oauth.data.url) throw oauth.error ?? new Error("Supabase no entregó la URL de Google");
      const result = await WebBrowser.openAuthSessionAsync(oauth.data.url, redirectTo);
      if (result.type !== "success" || !result.url) return;
      const tokens = parseOAuthTokens(result.url);
      if (!tokens.accessToken || !tokens.refreshToken) throw new Error("Google no devolvió la sesión completa");
      const applied = await supabase.auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
      if (applied.error) throw applied.error;
    } catch (error) {
      Alert.alert("No se pudo entrar con Google", error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={s.login}>
      <View style={s.glow} />
      <View style={s.loginPanel}>
        <View style={s.mark}><Text style={s.markText}>C</Text></View>
        <Text style={s.loginTitle}>CLOUVA CONTROL</Text>
        <Text style={s.muted}>Cabina Android privada para ver, probar y controlar CLOUVA desde el celular.</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email administrador" placeholderTextColor="#716a80" style={s.input} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" placeholderTextColor="#716a80" style={s.input} />
        <PrimaryButton label={busy ? "Entrando..." : "Entrar"} onPress={() => void signIn()} disabled={busy || !email || !password} />
        <PrimaryButton label="Continuar con Google" onPress={() => void google()} secondary disabled={busy} />
        <Text style={s.foot}>El backend valida el rol real. El APK no contiene claves administrativas.</Text>
      </View>
    </SafeAreaView>
  );
}

function PreviewScreen({ session, screen, persona, setPersona, report, close }: { session: Session; screen: ScreenDefinition | null; persona: PreviewPersona; setPersona: (value: PreviewPersona) => void; report: () => void; close: () => void }) {
  const web = useRef<WebView>(null);
  const [reload, setReload] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspector, setInspector] = useState<InspectorInfo | null>(null);
  const [problem, setProblem] = useState<PreviewProblem | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const uri = previewUrl(session, screen?.route ?? "/matrix", persona);
  const personaLabel = PERSONAS.find((item) => item.id === persona)?.label ?? persona;

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        web.current?.goBack();
        return true;
      }
      close();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack, close]);

  function reloadSession() {
    setProblem(null);
    setReload((value) => value + 1);
  }

  async function refreshSession() {
    const result = await supabase.auth.refreshSession();
    if (result.error || !result.data.session) {
      setProblem({ title: "La sesión no pudo recuperarse", detail: result.error?.message ?? "Supabase no devolvió una sesión activa." });
      return;
    }
    reloadSession();
  }

  function inspect() {
    setInspecting(true);
    web.current?.injectJavaScript(`
      (() => {
        if (window.__clouvaCleanup) window.__clouvaCleanup();
        const path = (element) => {
          const parts = [];
          let current = element;
          while (current && current.nodeType === 1 && parts.length < 6) {
            let part = current.tagName.toLowerCase();
            if (current.id) part += '#' + current.id;
            else if (current.classList?.length) part += '.' + Array.from(current.classList).slice(0, 2).join('.');
            parts.unshift(part);
            current = current.parentElement;
          }
          return parts.join(' > ');
        };
        const click = (event) => {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const rect = target.getBoundingClientRect();
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'clouva-inspector', payload: {
            tag: target.tagName.toLowerCase(),
            id: target.id || null,
            classes: Array.from(target.classList || []).slice(0, 12),
            text: (target.innerText || target.getAttribute('aria-label') || '').trim().slice(0, 500),
            path: path(target),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          }}));
          window.__clouvaCleanup();
        };
        window.__clouvaCleanup = () => { document.removeEventListener('click', click, true); delete window.__clouvaCleanup; };
        document.addEventListener('click', click, true);
      })(); true;
    `);
  }

  function clearState() {
    Alert.alert("Limpiar estado", "Se borrarán los datos locales de esta vista de prueba.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Limpiar", style: "destructive", onPress: () => web.current?.injectJavaScript("try{localStorage.clear();sessionStorage.clear();}catch(e){}window.location.reload();true;") },
    ]);
  }

  function onMessage(event: WebViewMessageEvent) {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; payload?: InspectorInfo; error?: string };
      if (message.type === "clouva-inspector" && message.payload) {
        setInspector(message.payload);
        setInspecting(false);
      }
      if (message.type === "clouva-preview-session-error") {
        setProblem({ title: "La sesión móvil llegó incompleta", detail: message.error ?? "La vista web informó que faltan datos de autenticación." });
      }
    } catch {
      // El bridge puede recibir mensajes de otras áreas de CLOUVA.
    }
  }

  return (
    <View style={s.preview}>
      <View style={s.previewTitleBar}>
        <Pressable onPress={close} style={s.backButton}><Text style={s.backButtonText}>‹</Text></Pressable>
        <View style={s.flex}><Text style={s.previewTitle}>Estás probando como {personaLabel}</Text><Text style={s.code}>{screen?.route ?? "/matrix"}</Text></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.personas}>
        {PERSONAS.map((item) => (
          <Pressable key={item.id} onPress={() => { setPersona(item.id); setProblem(null); }} style={[s.persona, persona === item.id && s.personaActive]}>
            <Text style={s.personaText}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={s.previewBar}>
        <View style={s.flex}><Text style={s.rowTitle}>{screen?.name ?? "La Matrix"}</Text></View>
        <Pressable disabled={!canGoBack} onPress={() => web.current?.goBack()} style={[s.tool, !canGoBack && s.disabled]}><Text style={s.toolText}>‹</Text></Pressable>
        <Pressable onPress={reloadSession} style={s.tool}><Text style={s.toolText}>↻</Text></Pressable>
        <Pressable onPress={inspect} style={[s.tool, inspecting && s.toolActive]}><Text style={s.toolText}>⌖</Text></Pressable>
        <Pressable onPress={clearState} style={s.tool}><Text style={s.toolText}>⌫</Text></Pressable>
        <Pressable onPress={report} style={s.tool}><Text style={[s.toolText, { color: C.red }]}>!</Text></Pressable>
      </View>
      {inspecting ? <View style={s.inspectBanner}><Text style={s.inspectBannerText}>Tocá un elemento para inspeccionarlo</Text></View> : null}
      <View style={s.webFrame}>
        <WebView
          key={`${uri}-${reload}`}
          ref={web}
          source={{ uri }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          onLoadStart={() => setProblem(null)}
          onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
          onMessage={onMessage}
          onError={(event) => setProblem({ title: "CLOUVA no pudo abrir esta vista", detail: event.nativeEvent.description })}
          onHttpError={(event) => setProblem({ title: `La vista respondió ${event.nativeEvent.statusCode}`, detail: event.nativeEvent.description || "La página devolvió un error HTTP." })}
          style={s.web}
        />
        {problem ? (
          <View style={s.problemOverlay}>
            <View style={s.problemCard}>
              <View style={s.problemIcon}><Text style={s.problemIconText}>!</Text></View>
              <Text style={s.problemTitle}>{problem.title}</Text>
              <Text style={s.muted}>{problem.detail}</Text>
              <PrimaryButton label="Reconectar sesión" onPress={reloadSession} />
              <PrimaryButton label="Volver a autenticar" onPress={() => void refreshSession()} secondary />
              <PrimaryButton label="Abrir CLOUVA nuevamente" onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}${screen?.route ?? "/matrix"}`)} secondary />
              <PrimaryButton label="Ver diagnóstico" onPress={() => setDiagnostics(true)} secondary />
            </View>
          </View>
        ) : null}
      </View>

      <Modal visible={Boolean(inspector)} transparent animationType="slide" onRequestClose={() => setInspector(null)}>
        <View style={s.backdrop}><SafeAreaView style={s.sheet}>
          <Text style={s.sectionTitle}>Inspector visual</Text>
          {inspector ? <>
            <Text style={s.muted}>{inspector.tag} · {Math.round(inspector.rect.width)} × {Math.round(inspector.rect.height)}</Text>
            <Text selectable style={s.inspectorPath}>{inspector.path}</Text>
            {inspector.id ? <Text style={s.muted}>ID: {inspector.id}</Text> : null}
            {inspector.classes.length ? <Text style={s.muted}>Clases: {inspector.classes.join(" · ")}</Text> : null}
            {inspector.text ? <Text selectable style={s.inspectorText}>{inspector.text}</Text> : null}
          </> : null}
          <PrimaryButton label="Cerrar" onPress={() => setInspector(null)} />
        </SafeAreaView></View>
      </Modal>

      <Modal visible={diagnostics} transparent animationType="slide" onRequestClose={() => setDiagnostics(false)}>
        <View style={s.backdrop}><SafeAreaView style={s.sheet}>
          <Text style={s.sectionTitle}>Diagnóstico de sesión móvil</Text>
          <Text style={s.muted}>Rol simulado: {personaLabel}</Text>
          <Text style={s.muted}>Ruta: {screen?.route ?? "/matrix"}</Text>
          <Text style={s.muted}>Usuario real: {session.user.id}</Text>
          <Text style={s.muted}>Sesión vence: {session.expires_at ? new Date(session.expires_at * 1000).toLocaleString("es-AR") : "sin dato"}</Text>
          <Text selectable style={s.code}>{problem?.detail ?? "No hay un error activo."}</Text>
          <PrimaryButton label="Cerrar" onPress={() => setDiagnostics(false)} />
        </SafeAreaView></View>
      </Modal>
    </View>
  );
}

function IssueModal({ visible, route, close, submit }: { visible: boolean; route: string | null; close: () => void; submit: (draft: IssueDraft) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("media");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(source: "camera" | "library") {
    try {
      const permission = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("Se necesita permiso para adjuntar evidencia");
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.72, base64: true };
      const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets.at(0);
      const base64 = asset?.base64;
      if (!asset || !base64) return;
      setAttachment({ base64, mime: asset.mimeType ?? "image/jpeg", label: source === "camera" ? "Foto tomada" : asset.fileName ?? "Imagen de galería" });
    } catch (error) {
      Alert.alert("No se pudo adjuntar", error instanceof Error ? error.message : "Error desconocido");
    }
  }

  async function save() {
    setBusy(true);
    try {
      await submit({ title, description, priority, attachment });
      setTitle("");
      setDescription("");
      setPriority("media");
      setAttachment(null);
    } catch (error) {
      Alert.alert("No se pudo guardar", error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={s.backdrop}><SafeAreaView style={s.sheet}>
        <Text style={s.sectionTitle}>Registrar problema</Text><Text style={s.code}>{route ?? "Sin ruta"}</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="Qué está mal" placeholderTextColor="#716a80" style={s.input} />
        <TextInput value={description} onChangeText={setDescription} placeholder="Qué esperabas" placeholderTextColor="#716a80" multiline style={[s.input, s.description]} />
        <View style={s.wrap}>{["baja", "media", "alta", "critica"].map((item) => <Pressable key={item} onPress={() => setPriority(item)} style={[s.persona, priority === item && s.personaActive]}><Text style={s.personaText}>{item}</Text></Pressable>)}</View>
        <View style={s.wrap}>
          <Pressable onPress={() => void choose("camera")} style={s.attach}><Text style={s.attachText}>Cámara</Text></Pressable>
          <Pressable onPress={() => void choose("library")} style={s.attach}><Text style={s.attachText}>Galería</Text></Pressable>
          {attachment ? <Pressable onPress={() => setAttachment(null)} style={[s.attach, s.attachReady]}><Text style={s.attachText}>{attachment.label} ×</Text></Pressable> : null}
        </View>
        <PrimaryButton label={busy ? "Guardando..." : attachment ? "Guardar con adjunto" : "Guardar con captura"} onPress={() => void save()} disabled={busy || !title.trim()} />
        <PrimaryButton label="Cancelar" onPress={close} secondary disabled={busy} />
      </SafeAreaView></View>
    </Modal>
  );
}

function ControlApp({ session }: { session: Session }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<PrimaryTab>("home");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [screen, setScreen] = useState<ScreenDefinition | null>(null);
  const [persona, setPersona] = useState<PreviewPersona>("admin");
  const [issueOpen, setIssueOpen] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeState>("connecting");
  const capture = useRef<View>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function rejectUnauthorized(error: unknown) {
    if (!(error instanceof AdminApiError) || ![401, 403].includes(error.status)) return false;
    Alert.alert("Acceso bloqueado", "Esta cuenta ya no tiene permiso administrativo para usar CLOUVA CONTROL.");
    await supabase.auth.signOut();
    return true;
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await adminFetch<Overview>("/api/admin/clouva-control/overview");
      setOverview(data);
      setScreen((current) => current ?? data.screens.find((item) => item.id === "matrix") ?? data.screens.at(0) ?? null);
    } catch (error) {
      if (!await rejectUnauthorized(error)) Alert.alert("CLOUVA CONTROL", error instanceof Error ? error.message : "No se pudo cargar");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const scheduleLoad = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 700);
  }, [load]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    setRealtime("connecting");
    const channel = supabase
      .channel("clouva-control-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_mobile_issues" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "avatar_analyzer_jobs" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "vip_profile_generation_jobs" }, scheduleLoad)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtime("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRealtime("error");
        else if (status === "CLOSED") setRealtime("disconnected");
        else setRealtime("connecting");
      });
    return () => {
      void supabase.removeChannel(channel);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [scheduleLoad]);

  const latest = overview?.releases.find((release) => release.is_stable) ?? overview?.releases.at(0) ?? null;
  const currentVersion = Application.nativeApplicationVersion ?? "0.0.0";
  const mandatory = latest?.minimum_required && compareVersions(currentVersion, latest.minimum_required) < 0 ? latest : null;

  function openRoute(route: string, name?: string) {
    if (!overview) return;
    const existing = overview.screens.find((item) => item.route === route) ?? null;
    const synthesized: ScreenDefinition = existing ?? {
      id: `virtual-${route}`,
      name: name ?? route,
      route,
      module: "Mapa operativo",
      status: "active",
      allowedRoles: [],
      previewStates: PERSONAS.map((item) => item.id),
      entryPoints: [],
      exits: [],
      enabled: true,
    };
    setScreen(synthesized);
    setPreviewOpen(true);
  }

  async function install(release: ReleaseRow) {
    setInstalling(release.id);
    try {
      await downloadAndInstallRelease(release);
    } catch (error) {
      if (!await rejectUnauthorized(error)) Alert.alert("No se pudo instalar", error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setInstalling(null);
    }
  }

  async function updateIssue(issue: IssueRow, status: string) {
    try {
      await adminFetch(`/api/admin/clouva-control/issues/${issue.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (error) {
      if (!await rejectUnauthorized(error)) Alert.alert("No se pudo actualizar", error instanceof Error ? error.message : "Error desconocido");
    }
  }

  async function submitIssue(draft: IssueDraft) {
    let screenshotBase64 = draft.attachment?.base64 ?? null;
    if (!screenshotBase64 && previewOpen && capture.current) {
      try {
        screenshotBase64 = await captureRef(capture.current, { format: "jpg", quality: 0.72, result: "base64" });
      } catch {
        screenshotBase64 = null;
      }
    }
    await adminFetch("/api/admin/clouva-control/issues", {
      method: "POST",
      body: JSON.stringify({
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
        module: screen?.module ?? null,
        route: screen?.route ?? null,
        previewPersona: persona,
        screenshotBase64,
        screenshotMime: draft.attachment?.mime ?? "image/jpeg",
        ...deviceEvidence(),
      }),
    });
    setIssueOpen(false);
    await load();
  }

  if (!overview) return <View style={s.loading}><ActivityIndicator size="large" color={C.violet} /><Text style={s.muted}>Leyendo CLOUVA...</Text></View>;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ControlHeader overview={overview} refreshing={refreshing} onRefresh={() => void load()} realtime={realtime} />
      <View style={s.main}>
        {previewOpen ? (
          <View ref={capture} collapsable={false} style={s.flex}>
            <PreviewScreen session={session} screen={screen} persona={persona} setPersona={setPersona} report={() => setIssueOpen(true)} close={() => setPreviewOpen(false)} />
          </View>
        ) : (
          <>
            {tab === "home" ? <HomeScreen overview={overview} navigate={setTab} openPreview={() => setPreviewOpen(true)} openRoute={openRoute} /> : null}
            {tab === "map" ? <OperationalMapScreen overview={overview} openRoute={openRoute} navigate={setTab} /> : null}
            {tab === "processes" ? <ProcessesScreen processes={overview.processes} openRoute={openRoute} /> : null}
            {tab === "issues" ? <ProblemsScreen incidents={overview.incidents} issues={overview.issues} createIssue={() => setIssueOpen(true)} updateIssue={(issue, status) => void updateIssue(issue, status)} openRoute={openRoute} /> : null}
            {tab === "system" ? <SystemScreen overview={overview} realtime={realtime} releases={overview.releases} install={(release) => void install(release)} installing={installing} openPreview={() => setPreviewOpen(true)} signOut={() => void supabase.auth.signOut()} /> : null}
          </>
        )}
      </View>
      {!previewOpen ? <BottomNav tab={tab} onChange={setTab} /> : null}
      <IssueModal visible={issueOpen} route={screen?.route ?? null} close={() => setIssueOpen(false)} submit={submitIssue} />
      <Modal visible={Boolean(mandatory)} transparent animationType="fade">
        <View style={s.backdrop}><View style={s.updateBox}>
          <Text style={s.sectionTitle}>Actualización obligatoria</Text>
          <Text style={s.muted}>Esta instalación es v{currentVersion}. Se requiere como mínimo v{mandatory?.minimum_required}.</Text>
          {mandatory ? <PrimaryButton label={installing ? "Descargando..." : `Instalar v${mandatory.version}`} onPress={() => void install(mandatory)} disabled={Boolean(installing)} /> : null}
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

export default function AppRoot() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then((result) => setSession(result.data.session ?? null));
    const subscription = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.data.subscription.unsubscribe();
  }, []);
  return <SafeAreaProvider>{session === undefined ? <View style={s.loading}><ActivityIndicator color={C.violet} /></View> : session ? <ControlApp session={session} /> : <LoginScreen />}</SafeAreaProvider>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  main: { flex: 1 },
  flex: { flex: 1 },
  loading: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 12 },
  login: { flex: 1, justifyContent: "center", padding: 22, backgroundColor: C.bg, overflow: "hidden" },
  glow: { position: "absolute", width: 360, height: 360, borderRadius: 999, backgroundColor: "rgba(124,58,237,.2)", top: -140, right: -150 },
  loginPanel: { gap: 14, backgroundColor: "rgba(16,13,28,.96)", borderWidth: 1, borderColor: C.border, borderRadius: 30, padding: 24 },
  mark: { width: 64, height: 64, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: C.violet },
  markText: { color: "white", fontSize: 32, fontWeight: "900" },
  loginTitle: { color: C.text, fontSize: 28, fontWeight: "900" },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  rowTitle: { color: C.text, fontWeight: "800", fontSize: 13, flexShrink: 1 },
  code: { color: "#81798e", fontSize: 10, lineHeight: 15, fontFamily: "monospace", marginTop: 2 },
  sectionTitle: { color: C.text, fontSize: 20, fontWeight: "900" },
  foot: { color: "#777083", textAlign: "center", fontSize: 11, lineHeight: 16 },
  input: { color: C.text, backgroundColor: "rgba(255,255,255,.045)", borderWidth: 1, borderColor: "rgba(255,255,255,.1)", borderRadius: 15, minHeight: 52, paddingHorizontal: 15, paddingVertical: 13 },
  description: { minHeight: 110, textAlignVertical: "top" },
  disabled: { opacity: 0.4 },
  preview: { flex: 1, backgroundColor: C.bg },
  previewTitleBar: { paddingHorizontal: 11, paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 9 },
  backButton: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: C.panel, borderWidth: 1, borderColor: C.border },
  backButtonText: { color: C.violetSoft, fontSize: 28, lineHeight: 30 },
  previewTitle: { color: C.text, fontSize: 14, fontWeight: "900" },
  personas: { gap: 7, paddingHorizontal: 12, paddingVertical: 9 },
  persona: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.045)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)" },
  personaActive: { backgroundColor: "rgba(139,92,246,.35)", borderColor: "rgba(196,181,253,.55)" },
  personaText: { color: C.text, fontSize: 10, fontWeight: "800" },
  previewBar: { paddingHorizontal: 10, paddingBottom: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  tool: { width: 36, height: 39, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, alignItems: "center", justifyContent: "center" },
  toolActive: { backgroundColor: "rgba(139,92,246,.3)" },
  toolText: { color: C.violetSoft, fontSize: 18, fontWeight: "800" },
  inspectBanner: { marginHorizontal: 9, marginBottom: 7, borderRadius: 12, borderWidth: 1, borderColor: "rgba(196,181,253,.32)", backgroundColor: "rgba(139,92,246,.15)", padding: 8 },
  inspectBannerText: { color: C.violetSoft, textAlign: "center", fontSize: 11, fontWeight: "800" },
  webFrame: { flex: 1, marginHorizontal: 8, marginBottom: 7, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: C.border, backgroundColor: "black" },
  web: { flex: 1, backgroundColor: "#050409" },
  problemOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(5,4,9,.88)", alignItems: "center", justifyContent: "center", padding: 22 },
  problemCard: { width: "100%", maxWidth: 430, borderRadius: 25, backgroundColor: C.panel2, borderWidth: 1, borderColor: "rgba(252,165,165,.28)", padding: 20, gap: 10 },
  problemIcon: { width: 50, height: 50, borderRadius: 18, backgroundColor: "rgba(252,165,165,.12)", borderWidth: 1, borderColor: "rgba(252,165,165,.3)", alignItems: "center", justifyContent: "center" },
  problemIconText: { color: C.red, fontSize: 24, fontWeight: "900" },
  problemTitle: { color: C.text, fontSize: 20, fontWeight: "900" },
  inspectorPath: { color: C.violetSoft, fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
  inspectorText: { color: C.text, backgroundColor: "rgba(255,255,255,.04)", borderRadius: 14, padding: 12, fontSize: 12, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.72)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.panel2, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12, maxHeight: "92%" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  attach: { minHeight: 38, justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,.1)", backgroundColor: "rgba(255,255,255,.05)", paddingHorizontal: 12 },
  attachReady: { borderColor: "rgba(110,231,183,.35)", backgroundColor: "rgba(110,231,183,.1)" },
  attachText: { color: C.text, fontSize: 11, fontWeight: "800" },
  updateBox: { margin: 22, backgroundColor: C.panel2, borderWidth: 1, borderColor: "rgba(252,211,77,.28)", borderRadius: 26, padding: 22, gap: 13 },
});
