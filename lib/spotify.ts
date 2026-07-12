export function spotifyEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.includes("spotify.com")) return null;
    if (u.pathname.startsWith("/embed/")) return url;
    return `https://open.spotify.com/embed${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}
