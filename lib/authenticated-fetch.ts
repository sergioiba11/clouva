export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sesión requerida.");

  return fetch(input, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...init.headers,
      authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `La solicitud falló (HTTP ${response.status}).`);
  return payload;
}
