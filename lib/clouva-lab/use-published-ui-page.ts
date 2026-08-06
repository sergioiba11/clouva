"use client";

import { useEffect, useState } from "react";

type PublishedPagePayload<T> = {
  slug: string;
  name: string;
  route: string;
  platform: string;
  version: number;
  published_at: string | null;
  config: T;
};

export function usePublishedUiPage<T>(
  slug: string,
  fallback: T,
  sanitize: (value: unknown) => T,
  override?: T,
) {
  const [config, setConfig] = useState<T>(override ?? fallback);
  const [version, setVersion] = useState<number | null>(override ? null : 0);
  const [loading, setLoading] = useState(!override);

  useEffect(() => {
    if (override) {
      setConfig(sanitize(override));
      setVersion(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { supabase } = await import("@/lib/supabase");
        const result = await supabase.rpc("ui_get_published_page", { p_slug: slug });
        if (result.error) throw result.error;
        const payload = result.data as PublishedPagePayload<unknown> | null;
        if (!cancelled) {
          setConfig(payload?.config ? sanitize(payload.config) : fallback);
          setVersion(payload?.version ?? 0);
        }
      } catch (error) {
        console.error(`No se pudo cargar la configuración publicada de ${slug}`, error);
        if (!cancelled) {
          setConfig(fallback);
          setVersion(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [fallback, override, sanitize, slug]);

  return { config, version, loading };
}
