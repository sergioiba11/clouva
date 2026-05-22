const PROD_ORIGIN = "https://clouva.com.ar";

export function getSiteUrl() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envOrigin) {
    return envOrigin.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    return PROD_ORIGIN;
  }

  return PROD_ORIGIN;
}

export function getOAuthCallbackUrl(nextPath = "/cuenta") {
  const baseUrl = getSiteUrl();
  const callbackUrl = new URL("/auth/callback", baseUrl);
  callbackUrl.searchParams.set("next", nextPath);
  return callbackUrl.toString();
}
