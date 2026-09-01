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
  const src = tone === "light"
    ? "/assets/clouva/brand/logo-official-light.png"
    : "/assets/clouva/brand/logo-official-dark.png";

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={`block select-none object-contain ${className}`}
    />
  );
}
