type OfficialClouvaMarkProps = {
  className?: string;
  tone?: "light" | "dark";
  alt?: string;
};

const LIGHT_SRC = "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/file_0000000021bc820e8c0114ee2fce3109.png";
const DARK_SRC = "https://storage.googleapis.com/clouva-generated-media/admin-assets/brand/file_00000000c5e4820e9a9efab6396e36b0.png";

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
      className={`block select-none object-contain ${className}`}
    />
  );
}
