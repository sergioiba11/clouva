import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
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
} from "./lib";

WebBrowser.maybeCompleteAuthSession();

const C = {
  bg: "#07060d",
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

function Panel({ children }: { children: React.ReactNode }) {
  return <View style={s.panel}>{children}</View>;
}

function Button({ label, onPress, secondary = false, disabled = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.buttonSecondary, disabled && s.disabled, pressed && !disabled && { opacity: 0.75 }]}>
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Badge({ children, tone = "violet" }: { children: React.ReactNode; tone?: "violet" | "green" | "red" | "amber" }) {
  const color = tone === "green" ? C.green : tone === "red" ? C.red : tone === "amber" ? C.amber : C.violetSoft;
  return <View style={[s.badge, { borderColor: `${color}55`, backgroundColor: `${color}16` }]}><Text style={[s.badgeText, { color }]}>{children}</Text></View>;
}

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
        <Text style={s.muted}>Consola Android privada para dirigir, probar y revisar CLOUVA desde el celular.</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email administrador" placeholderTextColor="#716a80" style={s.input} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Contraseña" placeholderTextColor="#716a80" style={s.input} />
        <Button label={busy ? "Entrando..." : "Entrar"} onPress={() => void signIn()} disabled={busy || !email || !password} />
        <Button label="Continuar con Google" onPress={() => void google()} secondary disabled={busy} />
        <Text style={s.foot}>El backend vuelve a validar el rol real. El APK no contiene claves administrativas.</Text>
      </View>
    </SafeAreaView>
  );
}

function Header({ overview, refreshing, refresh }: { overview: Overview | null; refreshing: boolean; refresh: () => void }) {
  return (
    <View style={s.header}>
      <View>
        <Text style={s.eyebrow}>CENTRO DE CONTROL MÓVIL</Text>
        <Text style={s.headerTitle}>CLOUVA CONTROL</Text>
        <Text style={s.headerMeta}>{overview ? `${overview.screens.length} pantallas · ${overview.processes.length} procesos` : "Conectando"}</Text>
      </View>
      <Pressable onPress={refresh} style={s.refresh}><Text style={s.refreshText}>{refreshing ? "…" : "↻"}</Text></Pressable>
    </View>
  );
}

function FlowCard({ flow, open }: { flow: FlowDefinition; open: (route: string) => void }) {
  return (
    <Panel>
      <Text style={s.cardTitle}>{flow.name}</Text>
      <Text style={s.muted}>{flow.description}</Text>
      {flow.steps.map((step, index) => (
        <Pressable key={`${flow.id}-${index}`} onPress={() => open(step.route)} style={s.flowStep}>
          <Text style={s.flowNumber}>{index + 1}</Text>
          <View style={s.flex}><Text style={s.rowTitle}>{step.label}</Text><Text style={s.small}>{step.expected}</Text></View>
          <Text style={s.chevron}>›</Text>
        </Pressable>
      ))}
    </Panel>
  );
}

function MapScreen({ overview, open }: { overview: Overview; open: (screen: ScreenDefinition) => void }) {
  const groups = useMemo(() => {
    const result = new Map<string, ScreenDefinition[]>();
    for (const screen of overview.screens) result.set(screen.module, [...(result.get(screen.module) ?? []), screen]);
    return [...result.entries()];
  }, [overview.screens]);

  const issueCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const issue of overview.issues) {
      if (!issue.route || issue.status === "resuelto") continue;
      result.set(issue.route, (result.get(issue.route) ?? 0) + 1);
    }
    return result;
  }, [overview.issues]);

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Panel><Text style={s.sectionTitle}>Toda la aplicación</Text><Text style={s.muted}>Abrí cualquier área sin recordar rutas y revisala dentro de la app.</Text></Panel>
      {groups.map(([module, screens]) => (
        <View key={module} style={s.group}>
          <Text style={s.groupTitle}>{module}</Text>
          {screens.map((screen) => (
            <Pressable key={screen.id} onPress={() => open(screen)} style={s.screenRow}>
              <View style={s.flex}>
                <View style={s.rowBetween}>
                  <Text style={s.rowTitle}>{screen.name}</Text>
                  <View style={s.badges}>
                    {(issueCounts.get(screen.route) ?? 0) > 0 ? <Badge tone="red">{issueCounts.get(screen.route)} abiertos</Badge> : null}
                    <Badge tone={screen.status === "active" ? "green" : "violet"}>{screen.status}</Badge>
                  </View>
                </View>
                <Text style={s.code}>{screen.route}</Text>
              </View>
              <Text style={s.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      ))}
      <Text style={s.groupTitle}>Recorridos</Text>
      {overview.flows.map((flow) => <FlowCard key={flow.id} flow={flow} open={(route) => open({ id: flow.id, name: flow.name, route, module: "Recorridos", status: "active", allowedRoles: [], previewStates: PERSONAS.map((item) => item.id), enabled: true })} />)}
    </ScrollView>
  );
}

function PreviewScreen({ session, screen, persona, setPersona, report }: { session: Session; screen: ScreenDefinition | null; persona: PreviewPersona; setPersona: (value: PreviewPersona) => void; report: () => void }) {
  const web = useRef<WebView>(null);
  const [reload, setReload] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspector, setInspector] = useState<InspectorInfo | null>(null);
  const uri = previewUrl(session, screen?.route ?? "/matrix", persona);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      web.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack]);

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
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; payload?: InspectorInfo };
      if (message.type === "clouva-inspector" && message.payload) {
        setInspector(message.payload);
        setInspecting(false);
      }
    } catch {
      // Reserved for future native bridge messages.
    }
  }

  return (
    <View style={s.preview}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.personas}>
        {PERSONAS.map((item) => <Pressable key={item.id} onPress={() => setPersona(item.id)} style={[s.persona, persona === item.id && s.personaActive]}><Text style={s.personaText}>{item.label}</Text></Pressable>)}
      </ScrollView>
      <View style={s.previewBar}>
        <View style={s.flex}><Text style={s.rowTitle}>{screen?.name ?? "La Matrix"}</Text><Text style={s.code}>{screen?.route ?? "/matrix"}</Text></View>
        <Pressable disabled={!canGoBack} onPress={() => web.current?.goBack()} style={[s.tool, !canGoBack && s.disabled]}><Text style={s.toolText}>‹</Text></Pressable>
        <Pressable onPress={() => setReload((value) => value + 1)} style={s.tool}><Text style={s.toolText}>↻</Text></Pressable>
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
          onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
          onMessage={onMessage}
          style={s.web}
        />
      </View>
      <Modal visible={Boolean(inspector)} transparent animationType="slide" onRequestClose={() => setInspector(null)}>
        <View style={s.backdrop}><SafeAreaView style={s.sheet}>
          <Text style={s.sectionTitle}>Inspector visual</Text>
          {inspector ? <>
            <View style={s.rowBetween}><Badge>{inspector.tag}</Badge><Text style={s.small}>{Math.round(inspector.rect.width)} × {Math.round(inspector.rect.height)}</Text></View>
            <Text selectable style={s.inspectorPath}>{inspector.path}</Text>
            {inspector.id ? <Text style={s.muted}>ID: {inspector.id}</Text> : null}
            {inspector.classes.length ? <Text style={s.muted}>Clases: {inspector.classes.join(" · ")}</Text> : null}
            {inspector.text ? <Text selectable style={s.inspectorText}>{inspector.text}</Text> : null}
          </> : null}
          <Button label="Cerrar" onPress={() => setInspector(null)} />
        </SafeAreaView></View>
      </Modal>
    </View>
  );
}

function ProcessesScreen({ rows }: { rows: ProcessRow[] }) {
  return <FlatList data={rows} keyExtractor={(item) => `${item.source}-${item.id}`} contentContainerStyle={s.content} ListHeaderComponent={<Panel><Text style={s.sectionTitle}>Procesos reales</Text><Text style={s.muted}>Avatar, IA, importaciones, pagos, suscripciones y servicios.</Text></Panel>} renderItem={({ item }) => (
    <Panel>
      <View style={s.rowBetween}><Text style={s.cardTitle}>{item.label}</Text><Badge tone={item.status.includes("fail") || item.status.includes("error") ? "red" : item.status.includes("complete") || item.status.includes("paid") ? "green" : "amber"}>{item.status}</Badge></View>
      <Text style={s.code}>{item.source} · {item.id}</Text>
      {item.progress != null ? <View style={s.progress}><View style={[s.progressValue, { width: `${Math.max(0, Math.min(100, item.progress))}%` }]} /></View> : null}
      {item.error ? <Text style={s.error}>{item.error}</Text> : null}
      <Text style={s.small}>{item.createdAt ? new Date(item.createdAt).toLocaleString("es-AR") : "Sin fecha"}</Text>
    </Panel>
  )} />;
}

function IssuesScreen({ issues, create }: { issues: IssueRow[]; create: () => void }) {
  return <FlatList data={issues} keyExtractor={(item) => item.id} contentContainerStyle={s.content} ListHeaderComponent={<View style={s.gap}><Panel><Text style={s.sectionTitle}>Problemas registrados</Text><Text style={s.muted}>Ruta, persona, dispositivo, versión y evidencia.</Text></Panel><Button label="Registrar problema" onPress={create} /></View>} renderItem={({ item }) => (
    <Panel>
      <View style={s.rowBetween}><Text style={s.cardTitle}>{item.title}</Text><Badge tone={item.priority === "alta" || item.priority === "critica" ? "red" : "amber"}>{item.priority}</Badge></View>
      {item.description ? <Text style={s.muted}>{item.description}</Text> : null}
      <Text style={s.code}>{item.route ?? "Sin ruta"} · {item.preview_persona ?? "sin persona"}</Text>
      <Text style={s.small}>{item.status} · {new Date(item.created_at).toLocaleString("es-AR")}</Text>
    </Panel>
  )} />;
}

function SystemScreen({ releases, install, installing }: { releases: ReleaseRow[]; install: (release: ReleaseRow) => void; installing: string | null }) {
  return (
    <ScrollView contentContainerStyle={s.content}>
      <Panel><Text style={s.sectionTitle}>Sistema Android</Text><Text style={s.muted}>Instalada: v{Application.nativeApplicationVersion ?? "dev"}</Text><Text style={s.code}>com.clouva.control</Text></Panel>
      {releases.map((release) => (
        <Panel key={release.id}>
          <View style={s.rowBetween}><Text style={s.cardTitle}>v{release.version}</Text>{release.is_stable ? <Badge tone="green">estable</Badge> : <Badge>histórica</Badge>}</View>
          <Text style={s.muted}>{release.release_notes ?? "Sin notas"}</Text>
          <Text style={s.code}>build {release.build_number} · mínimo {release.minimum_required ?? "sin bloqueo"}</Text>
          <Text selectable style={s.small}>SHA-256: {release.checksum}</Text>
          <Button label={installing === release.id ? "Descargando..." : "Descargar e instalar"} onPress={() => install(release)} disabled={installing != null} />
        </Panel>
      ))}
      <Button label="Cerrar sesión" onPress={() => void supabase.auth.signOut()} secondary />
    </ScrollView>
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
      setTitle(""); setDescription(""); setPriority("media"); setAttachment(null);
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
        <Button label={busy ? "Guardando..." : attachment ? "Guardar con adjunto" : "Guardar con captura"} onPress={() => void save()} disabled={busy || !title.trim()} />
        <Button label="Cancelar" onPress={close} secondary disabled={busy} />
      </SafeAreaView></View>
    </Modal>
  );
}

function ControlApp({ session }: { session: Session }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabId>("map");
  const [screen, setScreen] = useState<ScreenDefinition | null>(null);
  const [persona, setPersona] = useState<PreviewPersona>("admin");
  const [issueOpen, setIssueOpen] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const capture = useRef<View>(null);

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

  useEffect(() => { void load(); }, [load]);

  const latest = overview?.releases.find((release) => release.is_stable) ?? overview?.releases.at(0) ?? null;
  const currentVersion = Application.nativeApplicationVersion ?? "0.0.0";
  const mandatory = latest?.minimum_required && compareVersions(currentVersion, latest.minimum_required) < 0 ? latest : null;

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

  async function submitIssue(draft: IssueDraft) {
    let screenshotBase64 = draft.attachment?.base64 ?? null;
    if (!screenshotBase64 && tab === "preview" && capture.current) {
      try { screenshotBase64 = await captureRef(capture.current, { format: "jpg", quality: 0.72, result: "base64" }); } catch { screenshotBase64 = null; }
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
      <Header overview={overview} refreshing={refreshing} refresh={() => void load()} />
      <View style={s.main}>
        {tab === "map" ? <MapScreen overview={overview} open={(value) => { setScreen(value); setTab("preview"); }} /> : null}
        {tab === "preview" ? <View ref={capture} collapsable={false} style={s.flex}><PreviewScreen session={session} screen={screen} persona={persona} setPersona={setPersona} report={() => setIssueOpen(true)} /></View> : null}
        {tab === "processes" ? <ProcessesScreen rows={overview.processes} /> : null}
        {tab === "issues" ? <IssuesScreen issues={overview.issues} create={() => setIssueOpen(true)} /> : null}
        {tab === "system" ? <SystemScreen releases={overview.releases} install={(release) => void install(release)} installing={installing} /> : null}
      </View>
      <View style={s.nav}>{TABS.map((item) => <Pressable key={item.id} onPress={() => setTab(item.id)} style={s.tab}><Text style={[s.tabGlyph, tab === item.id && s.active]}>{item.glyph}</Text><Text style={[s.tabLabel, tab === item.id && s.active]}>{item.label}</Text></Pressable>)}</View>
      <IssueModal visible={issueOpen} route={screen?.route ?? null} close={() => setIssueOpen(false)} submit={submitIssue} />
      <Modal visible={Boolean(mandatory)} transparent animationType="fade"><View style={s.backdrop}><View style={s.updateBox}><Text style={s.sectionTitle}>Actualización obligatoria</Text><Text style={s.muted}>Esta instalación es v{currentVersion}. Se requiere como mínimo v{mandatory?.minimum_required}.</Text>{mandatory ? <Button label={installing ? "Descargando..." : `Instalar v${mandatory.version}`} onPress={() => void install(mandatory)} disabled={Boolean(installing)} /> : null}</View></View></Modal>
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
  safe: { flex: 1, backgroundColor: C.bg }, main: { flex: 1 }, flex: { flex: 1 }, gap: { gap: 12 }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  login: { flex: 1, justifyContent: "center", padding: 22, backgroundColor: C.bg, overflow: "hidden" }, glow: { position: "absolute", width: 360, height: 360, borderRadius: 999, backgroundColor: "rgba(124,58,237,.2)", top: -140, right: -150 },
  loginPanel: { gap: 14, backgroundColor: "rgba(16,13,28,.96)", borderWidth: 1, borderColor: C.border, borderRadius: 30, padding: 24 }, mark: { width: 64, height: 64, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: C.violet }, markText: { color: "white", fontSize: 32, fontWeight: "900" }, loginTitle: { color: C.text, fontSize: 28, fontWeight: "900" }, foot: { color: "#777083", textAlign: "center", fontSize: 11, lineHeight: 16 },
  input: { color: C.text, backgroundColor: "rgba(255,255,255,.045)", borderWidth: 1, borderColor: "rgba(255,255,255,.1)", borderRadius: 15, minHeight: 52, paddingHorizontal: 15, paddingVertical: 13 }, description: { minHeight: 110, textAlignVertical: "top" },
  button: { minHeight: 50, borderRadius: 16, backgroundColor: C.violet, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 4 }, buttonSecondary: { backgroundColor: "rgba(255,255,255,.055)", borderWidth: 1, borderColor: "rgba(255,255,255,.12)" }, buttonText: { color: "white", fontWeight: "800", fontSize: 14 }, disabled: { opacity: 0.4 },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "rgba(255,255,255,.07)" }, eyebrow: { color: C.violetSoft, fontSize: 9, fontWeight: "800", letterSpacing: 1.8 }, headerTitle: { color: C.text, fontSize: 20, fontWeight: "900" }, headerMeta: { color: C.muted, fontSize: 11 }, refresh: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" }, refreshText: { color: C.violetSoft, fontSize: 21 },
  loading: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 12 }, content: { padding: 14, paddingBottom: 32, gap: 12 }, panel: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 16, gap: 8 }, sectionTitle: { color: C.text, fontSize: 19, fontWeight: "900" }, cardTitle: { color: C.text, fontSize: 15, fontWeight: "800", flexShrink: 1 }, muted: { color: C.muted, fontSize: 13, lineHeight: 19 }, small: { color: "#7f778c", fontSize: 10, lineHeight: 15 }, code: { color: "#81798e", fontSize: 11, fontFamily: "monospace", marginTop: 3 },
  group: { gap: 7 }, groupTitle: { color: C.violetSoft, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase", marginTop: 7, marginLeft: 4 }, screenRow: { minHeight: 66, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 18, backgroundColor: C.panel, borderWidth: 1, borderColor: "rgba(255,255,255,.07)", flexDirection: "row", alignItems: "center", gap: 10 }, rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, rowTitle: { color: C.text, fontWeight: "800", fontSize: 14, flexShrink: 1 }, badges: { flexDirection: "row", gap: 5 }, chevron: { color: C.violetSoft, fontSize: 27 }, badge: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 }, badgeText: { fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  flowStep: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: 1, borderColor: "rgba(255,255,255,.06)", paddingVertical: 9 }, flowNumber: { width: 28, height: 28, borderRadius: 10, backgroundColor: "rgba(139,92,246,.16)", color: C.violetSoft, textAlign: "center", textAlignVertical: "center", fontWeight: "900" },
  preview: { flex: 1, backgroundColor: C.bg }, personas: { gap: 7, paddingHorizontal: 12, paddingVertical: 9 }, persona: { minHeight: 35, paddingHorizontal: 12, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.045)", borderWidth: 1, borderColor: "rgba(255,255,255,.08)" }, personaActive: { backgroundColor: "rgba(139,92,246,.35)", borderColor: "rgba(196,181,253,.55)" }, personaText: { color: C.text, fontSize: 11, fontWeight: "800" }, previewBar: { paddingHorizontal: 10, paddingBottom: 9, flexDirection: "row", alignItems: "center", gap: 5 }, tool: { width: 36, height: 39, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, alignItems: "center", justifyContent: "center" }, toolActive: { backgroundColor: "rgba(139,92,246,.3)" }, toolText: { color: C.violetSoft, fontSize: 18, fontWeight: "800" }, inspectBanner: { marginHorizontal: 9, marginBottom: 7, borderRadius: 12, borderWidth: 1, borderColor: "rgba(196,181,253,.32)", backgroundColor: "rgba(139,92,246,.15)", padding: 8 }, inspectBannerText: { color: C.violetSoft, textAlign: "center", fontSize: 11, fontWeight: "800" }, webFrame: { flex: 1, marginHorizontal: 8, marginBottom: 7, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: C.border, backgroundColor: "black" }, web: { flex: 1, backgroundColor: "#050409" }, inspectorPath: { color: C.violetSoft, fontSize: 12, lineHeight: 18, fontFamily: "monospace" }, inspectorText: { color: C.text, backgroundColor: "rgba(255,255,255,.04)", borderRadius: 14, padding: 12, fontSize: 12, lineHeight: 18 },
  progress: { height: 7, borderRadius: 999, overflow: "hidden", backgroundColor: "rgba(255,255,255,.07)", marginTop: 8 }, progressValue: { height: "100%", backgroundColor: C.violet }, error: { color: C.red, fontSize: 12 },
  nav: { minHeight: 66, flexDirection: "row", borderTopWidth: 1, borderColor: "rgba(255,255,255,.08)", backgroundColor: "#0b0812", paddingBottom: 3 }, tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 }, tabGlyph: { color: "#756d82", fontSize: 17, fontWeight: "900" }, tabLabel: { color: "#756d82", fontSize: 9, fontWeight: "800" }, active: { color: C.violetSoft },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.72)", justifyContent: "flex-end" }, sheet: { backgroundColor: C.panel2, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: C.border, padding: 20, gap: 12, maxHeight: "92%" }, attach: { minHeight: 38, justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,.1)", backgroundColor: "rgba(255,255,255,.05)", paddingHorizontal: 12 }, attachReady: { borderColor: "rgba(110,231,183,.35)", backgroundColor: "rgba(110,231,183,.1)" }, attachText: { color: C.text, fontSize: 11, fontWeight: "800" }, updateBox: { margin: 22, backgroundColor: C.panel2, borderWidth: 1, borderColor: "rgba(252,211,77,.28)", borderRadius: 26, padding: 22, gap: 13 },
});
