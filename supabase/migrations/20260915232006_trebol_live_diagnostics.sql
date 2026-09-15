-- Safe transport diagnostics for Trébol / Gemini Live.
-- Raw audio, prompts, API keys, OAuth tokens and ephemeral Gemini credentials
-- must never be stored here.

alter table public.ai_agent_runs
  add column if not exists diagnostic_metadata jsonb not null default '{}'::jsonb;

comment on column public.ai_agent_runs.diagnostic_metadata is
  'Sanitized transport diagnostics such as Gemini Live close code/reason, phase, socket lifetime and last event names. Never stores audio or credentials.';
