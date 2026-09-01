type OfficialClouvaMarkProps = {
  className?: string;
  tone?: "light" | "dark";
  alt?: string;
};

// Canonical transparent marks already stored with the app. These are the
// processed derivatives of the official source artwork, so critical UI icons
// do not depend on an extra Google Cloud Storage request or inherit the flat
// black/white source backgrounds.
const LIGHT_SRC = "/assets/clouva/brand/logo-official-light.png";
const DARK_SRC = "/assets/clouva/brand/logo-official-dark.png";

export function OfficialClouvaMark({
  className = "",
  tone = "light",
  alt = "Logo oficial de CLOUVA",
}: OfficialClouvaMarkProps) {
  const src = tone === "light" ? LIGHT_SRC : DARK_SRC;

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      decoding="async"
      className={`block select-none object-contain ${className}`}
    />
  );
}
