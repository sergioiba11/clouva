// Convierte una URL pública de Spotify/YouTube en la URL de embed oficial de
// cada plataforma -- nunca se arma un iframe a partir de una URL que no
// matchee uno de estos patrones conocidos.
export type MusicEmbed = { platform: "spotify" | "youtube"; src: string };

const SPOTIFY_RE = /open\.spotify\.com\/(artist|album|playlist|track)\/([a-zA-Z0-9]+)/;
const YOUTUBE_VIDEO_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/;
const YOUTUBE_LIST_RE = /[?&]list=([a-zA-Z0-9_-]+)/;

export function parseMusicEmbed(url: string | null | undefined): MusicEmbed | null {
  if (!url || typeof url !== "string") return null;

  const spotifyMatch = url.match(SPOTIFY_RE);
  if (spotifyMatch) {
    return { platform: "spotify", src: `https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}?utm_source=generator&theme=0` };
  }

  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    const videoMatch = url.match(YOUTUBE_VIDEO_RE);
    if (videoMatch) return { platform: "youtube", src: `https://www.youtube.com/embed/${videoMatch[1]}` };
    const listMatch = url.match(YOUTUBE_LIST_RE);
    if (listMatch) return { platform: "youtube", src: `https://www.youtube.com/embed/videoseries?list=${listMatch[1]}` };
  }

  return null;
}
