"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

export function PasswordSecurityCard() {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providers = useMemo(() => {
    const values = [
      ...(Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : []),
      user?.app_metadata?.provider,
      ...(user?.identities?.map((identity) => identity.provider) ?? []),
    ];
    return new Set(values.filter(Boolean).map(String));
  }, [user]);

  const googleConnected = providers.has("google");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!user) {
      setError("Necesitás iniciar sesión para configurar una contraseña.");
      return;
    }

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      setPassword("");
      setConfirmation("");
      setMessage("Contraseña guardada. Ya podés entrar con tu correo y esta contraseña, o seguir usando Google.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No se pudo guardar la contraseña.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-violet-300/15 bg-[linear-gradient(145deg,rgba(124,58,237,.10),rgba(0,0,0,.22))] p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-200/65">Seguridad de la cuenta</p>
          <h2 className="mt-1 flex items-center gap-2 text-base font-semibold">
            <KeyRound className="h-4 w-4 text-violet-200" />
            Acceso con contraseña
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-white/50">
            Agregá una contraseña a esta misma cuenta CLOUVA. Google sigue conectado y no se crea otro usuario.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.1em]">
          {googleConnected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/[.06] px-2.5 py-1.5 text-emerald-100/80">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Google conectado
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.035] px-2.5 py-1.5 text-white/55">
            <ShieldCheck className="h-3.5 w-3.5" />
            Misma cuenta
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">Correo de acceso</div>
        <div className="mt-1 break-all text-sm font-medium text-white/80">{user?.email ?? "Sin correo disponible"}</div>
      </div>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-white/65">
          Nueva contraseña
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Mínimo 8 caracteres"
            className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-white outline-none placeholder:text-white/25 focus:border-violet-300/50"
          />
        </label>

        <label className="text-sm text-white/65">
          Repetir contraseña
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Repetila"
            className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-white outline-none placeholder:text-white/25 focus:border-violet-300/50"
          />
        </label>

        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={saving || !user}
            className="min-h-11 rounded-xl border border-violet-200/25 bg-violet-500/20 px-4 text-sm font-semibold text-violet-50 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Crear / cambiar contraseña"}
          </button>
          <p className="mt-2 text-xs leading-relaxed text-white/35">
            Después podés usar el formulario de correo + contraseña que ya existe en /login, o continuar entrando con Google.
          </p>
        </div>
      </form>

      {message ? (
        <p role="status" className="mt-3 rounded-xl border border-emerald-300/15 bg-emerald-300/[.05] px-3 py-2 text-sm text-emerald-100/80">
          {message}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-rose-300/15 bg-rose-300/[.05] px-3 py-2 text-sm text-rose-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}
