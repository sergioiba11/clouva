type OfficialClouvaMarkProps = {
  className?: string;
  tone?: "light" | "dark";
  alt?: string;
};

export function OfficialClouvaMark({
  className = "",
  tone = "light",
  alt = "Logo oficial de CLOUVA",
}: OfficialClouvaMarkProps) {
  const toneClass = tone === "light" ? "brightness-0 invert" : "brightness-0";

  return (
    <img
      src="/icon.svg"
      alt={alt}
      draggable={false}
      className={`block select-none object-contain ${toneClass} ${className}`}
    />
  );
}
