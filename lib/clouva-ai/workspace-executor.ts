// WorkspaceExecutor — Task 10. The second concrete ToolExecutor (see
// lib/clouva-ai/tool-executor.ts and Task 7's GitHubExecutor for the first).
// Resolves a CLOUVA user's active workspace_link (Task 8/9), decrypts the
// device token server-side, connects to the Gateway, authenticates, and
// dispatches tool calls to Desktop's real Tool Runtime
// (clouva-workspace/electron/ai/toolRuntime.ts's executeTool) over
// lib/clouva-ai/workspace-gateway.ts's WorkspaceGatewayConnection.
//
// Tool selection reuses Desktop's own Tool Runtime and permission catalog.
// Reads execute automatically; the narrowly exposed file/Preview mutations
// retain their write/destructive risk and therefore stop at the same
// persisted ToolConfirmationGate used by GitHub and Studio tools.
//
// Task 11 wires this executor into the live Orchestrator through ToolRouter.
// No renderer, model, or Gateway caller can turn a client-supplied flag into
// approval: only the Orchestrator's persisted confirmation resumes a write.

import { createAdminSupabase } from "../server/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workspaceDeviceTokenBox, type EncryptedSecret } from "../../core/crypto/secret-box";
import { WorkspaceGatewayConnection } from "./workspace-gateway";
import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";

type WorkspaceLinkRow = {
  workspace_id: string;
  device_token_ciphertext: string;
  device_token_iv: string;
  device_token_auth_tag: string;
};

export interface WorkspaceExecutorDeps {
  /** Injectable for tests — defaults to the real service-role client.
   * workspace_links has zero RLS policies (Task 8), so this is the only
   * thing scoping a lookup to `userId`. */
  supabase?: SupabaseClient;
  /** Injectable for tests — defaults to reading CLOUVA_CONTROL_GATEWAY_URL. */
  gatewayUrl?: string;
  /** Injectable for tests — defaults to workspaceDeviceTokenBox.decrypt. */
  decryptDeviceToken?: (secret: EncryptedSecret) => string;
}

export class WorkspaceExecutor extends BaseToolExecutor {
  readonly target = "workspace";

  private readonly userId: string;
  private readonly supabase: SupabaseClient;
  private readonly configuredGatewayUrl: string | undefined;
  private readonly decryptDeviceToken: (secret: EncryptedSecret) => string;
  private connectionPromise: Promise<WorkspaceGatewayConnection> | null = null;

  constructor(userId: string, deps: WorkspaceExecutorDeps = {}) {
    super();
    this.userId = userId;
    this.supabase = deps.supabase ?? createAdminSupabase();
    this.configuredGatewayUrl = deps.gatewayUrl;
    this.decryptDeviceToken = deps.decryptDeviceToken ?? ((secret) => workspaceDeviceTokenBox.decrypt(secret));
  }

  protected readonly definitions: ToolDefinition[] = [
    {
      name: "workspace.projects.list",
      description: "Lista todos los proyectos registrados en CLOUVA Workspace, con su estado y stack detectado.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.projects.list", {}),
    },
    {
      name: "workspace.projects.inspect",
      description: "Detalle completo de un proyecto registrado en Workspace.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { projectId: { type: "STRING", description: "Id del proyecto registrado en Workspace." } },
        required: ["projectId"],
      },
      execute: async (args: { projectId: string }) => (await this.connection()).request("workspace.projects.inspect", args),
    },
    {
      name: "workspace.git.status",
      description: "Estado real de git (rama, staged/unstaged/untracked) del repo de un proyecto.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { projectId: { type: "STRING", description: "Id del proyecto registrado en Workspace." } },
        required: ["projectId"],
      },
      execute: async (args: { projectId: string }) => (await this.connection()).request("workspace.git.status", args),
    },
    {
      name: "workspace.git.log",
      description: "Historial de commits reciente del repo de un proyecto.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          projectId: { type: "STRING", description: "Id del proyecto registrado en Workspace." },
          limit: { type: "NUMBER", description: "Cantidad de commits a devolver (default 15)." },
        },
        required: ["projectId"],
      },
      execute: async (args: { projectId: string; limit?: number }) => (await this.connection()).request("workspace.git.log", args),
    },
    {
      name: "workspace.process.list",
      description: "Procesos que Workspace inició, más procesos de desarrollo externos detectados.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.process.list", {}),
    },
    {
      name: "workspace.analyzer.status",
      description: "Si CLOUVA Analyzer (el worker de avatar/garment) está corriendo ahora.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.analyzer.status", {}),
    },
    {
      name: "workspace.aiAnalyzer.status",
      description: "Estado de la capa AI Analyzer local y de la observación actual del Preview.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.aiAnalyzer.status", {}),
    },
    {
      name: "workspace.aiAnalyzer.context",
      description: "Construye contexto técnico estructurado y bajo demanda desde Preview, Analyzer 3D, código, runtime o Git.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          scope: {
            type: "STRING",
            description: "Scope: project, selection, visual, scene, code, runtime, git, issues o full.",
          },
        },
        required: ["scope"],
      },
      execute: async (args: { scope: string }) => (await this.connection()).request("workspace.aiAnalyzer.context", args),
    },
    {
      name: "workspace.aiAnalyzer.issues",
      description: "Devuelve issues normalizados actuales del Preview, Analyzer 3D, Worker y runtime.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.aiAnalyzer.issues", {}),
    },
    {
      name: "workspace.aiAnalyzer.snapshot",
      description: "Captura un snapshot técnico antes o después de una acción para verificar el resultado.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { label: { type: "STRING", description: "Etiqueta breve del snapshot." } },
      },
      execute: async (args: { label?: string }) => (await this.connection()).request("workspace.aiAnalyzer.snapshot", args),
    },
    {
      name: "workspace.aiAnalyzer.compare",
      description: "Compara dos snapshots y devuelve cambios e issues resueltos, restantes y nuevos.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: {
          beforeId: { type: "STRING", description: "Id del snapshot anterior." },
          afterId: { type: "STRING", description: "Id del snapshot posterior." },
        },
        required: ["beforeId", "afterId"],
      },
      execute: async (args: { beforeId: string; afterId: string }) => (await this.connection()).request("workspace.aiAnalyzer.compare", args),
    },
    {
      name: "workspace.aiAnalyzer.activity",
      description: "Actividad reciente observable del AI Analyzer, sin razonamiento privado del modelo.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { limit: { type: "NUMBER", description: "Cantidad máxima de eventos recientes." } },
      },
      execute: async (args: { limit?: number }) => (await this.connection()).request("workspace.aiAnalyzer.activity", args),
    },
    {
      name: "workspace.activity.list",
      description: "Eventos recientes de actividad en Workspace (cambios de proceso/git/analyzer).",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { limit: { type: "NUMBER", description: "Cantidad de eventos a devolver (default 20)." } },
        required: [],
      },
      execute: async (args: { limit?: number }) => (await this.connection()).request("workspace.activity.list", args),
    },
    {
      name: "workspace.files.list",
      description: "Lista archivos y carpetas dentro de una ruta registrada en Workspace.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { path: { type: "STRING", description: "Ruta absoluta dentro de un proyecto registrado." } },
        required: ["path"],
      },
      execute: async (args: { path: string }) => (await this.connection()).request("workspace.files.list", args),
    },
    {
      name: "workspace.files.read",
      description: "Lee un archivo de texto real dentro de un proyecto registrado en Workspace.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { path: { type: "STRING", description: "Ruta absoluta del archivo." } },
        required: ["path"],
      },
      execute: async (args: { path: string }) => (await this.connection()).request("workspace.files.read", args),
    },
    {
      name: "workspace.files.write",
      description: "Reemplaza el contenido completo de un archivo local después de mostrar y aprobar su diff.",
      risk: "write",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING", description: "Ruta absoluta del archivo dentro del proyecto registrado." },
          content: { type: "STRING", description: "Contenido completo propuesto para el archivo." },
        },
        required: ["path", "content"],
      },
      execute: async (args: { path: string; content: string; expectedContentHash?: string }) =>
        (await this.connection()).request("workspace.files.write", args),
    },
    {
      name: "workspace.webPreview.status",
      description: "Obtiene estado, URL, puerto, PID y error de compilación del Web Preview local.",
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.webPreview.status", {}),
    },
    {
      name: "workspace.webPreview.logs",
      description: "Lee logs recientes del servidor Next.js local, incluidos warnings y errores.",
      risk: "read",
      parameters: {
        type: "OBJECT",
        properties: { afterSequence: { type: "NUMBER", description: "Secuencia mínima exclusiva; 0 devuelve el buffer disponible." } },
      },
      execute: async (args: { afterSequence?: number }) => (await this.connection()).request("workspace.webPreview.logs", args),
    },
    {
      name: "workspace.webPreview.start",
      description: "Inicia el comando dev registrado de CLOUVA Web dentro del Process Manager de Workspace.",
      risk: "write",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.webPreview.start", {}),
    },
    {
      name: "workspace.webPreview.stop",
      description: "Detiene el servidor de Web Preview iniciado por Workspace.",
      risk: "destructive",
      parameters: { type: "OBJECT", properties: {} },
      execute: async () => (await this.connection()).request("workspace.webPreview.stop", {}),
    },
  ];

  /** Lazily opens (and reuses) one authenticated connection per executor
   * instance — cheap enough to open per Orchestrator turn, and avoids
   * re-authenticating for every individual tool call Gemini makes within
   * the same turn. Callers must call close() when done with this executor
   * (one Orchestrator turn's worth of tool calls, not held across turns). */
  private connection(): Promise<WorkspaceGatewayConnection> {
    if (!this.connectionPromise) this.connectionPromise = this.openConnection();
    return this.connectionPromise;
  }

  private async openConnection(): Promise<WorkspaceGatewayConnection> {
    const gatewayUrl = this.configuredGatewayUrl ?? process.env.CLOUVA_CONTROL_GATEWAY_URL?.trim();
    if (!gatewayUrl) throw new Error("Falta CLOUVA_CONTROL_GATEWAY_URL (la URL /relay del Gateway de CLOUVA Workspace).");

    const { data: link, error } = await this.supabase
      .from("workspace_links")
      .select("workspace_id,device_token_ciphertext,device_token_iv,device_token_auth_tag")
      .eq("user_id", this.userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const row = link as WorkspaceLinkRow | null;
    if (!row) {
      throw new Error("Este usuario no tiene un Workspace conectado todavía — usá 'Conectar Workspace' en CLOUVA AI.");
    }

    const deviceToken = this.decryptDeviceToken({
      ciphertext: row.device_token_ciphertext,
      iv: row.device_token_iv,
      authTag: row.device_token_auth_tag,
    });

    const connection = await WorkspaceGatewayConnection.connect({
      gatewayUrl,
      workspaceId: row.workspace_id,
      deviceToken,
    });

    // Best-effort — a failed timestamp bump shouldn't fail the actual tool
    // call the caller is waiting on.
    void this.supabase
      .from("workspace_links")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", this.userId)
      .eq("workspace_id", row.workspace_id)
      .is("revoked_at", null)
      .then(undefined, (updateError: unknown) => {
        console.error("WorkspaceExecutor: failed to bump last_used_at", updateError);
      });

    return connection;
  }

  /** Closes the underlying connection, if one was ever opened. Safe to call
   * even if no tool was ever actually invoked. */
  async close(): Promise<void> {
    if (!this.connectionPromise) return;
    const connection = await this.connectionPromise.catch(() => null);
    connection?.close();
    this.connectionPromise = null;
  }
}
