import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ClouvaDomainExecutor } from "@/lib/clouva-ai/clouva-domain-executor";
import { ContextExecutor } from "@/lib/clouva-ai/context-executor";
import { GitHubExecutor } from "@/lib/clouva-ai/github-executor";
import { KnowledgeExecutor } from "@/lib/clouva-ai/knowledge-executor";
import { MemoryExecutor } from "@/lib/clouva-ai/memory-executor";
import { MediaExecutor } from "@/lib/clouva-ai/media-executor";
import type { ProjectToolScope } from "@/lib/clouva-ai/project-tool-scope";
import type { ToolExecutor } from "@/lib/clouva-ai/tool-executor";
import { ToolRouter } from "@/lib/clouva-ai/tool-router";
import { WorkspaceExecutor } from "@/lib/clouva-ai/workspace-executor";
import { RuntimeExecutor } from "@/lib/clouva-ai/runtime-executor";
import { createClouvaDomainService } from "@/lib/server/clouva-domain-service";
import { createAdminSupabase } from "@/lib/server/supabase";
import { TrebolMediaService } from "@/lib/server/trebol-media-service";
import { emptyTrebolRuntimeContext } from "./context-builder";
import type { TrebolRuntimeContext } from "./types";

export type AgentToolServiceOptions = {
  userId: string;
  project: boolean;
  studioId: string | null;
  supabase: SupabaseClient;
  currentContext?: TrebolRuntimeContext;
  includeRuntime?: boolean;
  includeMedia?: boolean;
  conversationId?: string | null;
  transport?: "text" | "live";
  projectScope?: ProjectToolScope;
  additionalExecutors?: ToolExecutor[];
};

/** The single registry factory used by text, Live and confirmations. */
export async function createAgentToolRouter(options: AgentToolServiceOptions): Promise<ToolRouter> {
  const executors: ToolExecutor[] = [
    new ContextExecutor(options.currentContext ?? emptyTrebolRuntimeContext()),
    new MemoryExecutor(options.supabase, options.userId, options.studioId),
    new KnowledgeExecutor(
      options.supabase,
      options.userId,
      options.studioId,
      options.conversationId ?? null,
    ),
    ...(options.additionalExecutors ?? []),
  ];

  if (options.includeRuntime !== false || options.includeMedia !== false) {
    const { data, error } = await options.supabase.rpc("clouva_control_is_admin");
    if (error) console.warn("Trébol could not validate CLOUVA CONTROL access", error.message);
    if (data === true) {
      if (options.includeRuntime !== false) executors.push(new RuntimeExecutor(options.supabase));
      if (options.includeMedia !== false) {
        executors.push(new MediaExecutor(
          new TrebolMediaService(options.supabase, createAdminSupabase(), options.userId),
          options.transport ?? "text",
          options.conversationId ?? null,
        ));
      }
    }
  }
  if (options.project) {
    if (options.projectScope !== "workspace") executors.push(new GitHubExecutor());
    executors.push(new WorkspaceExecutor(options.userId));
  }
  if (options.studioId) {
    executors.push(new ClouvaDomainExecutor(createClouvaDomainService({
      admin: createAdminSupabase(),
      userId: options.userId,
      studioId: options.studioId,
    })));
  }
  return new ToolRouter(executors);
}
