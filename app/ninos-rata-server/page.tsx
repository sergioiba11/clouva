import type { Metadata } from "next";
import { MinecraftServerPanel } from "./MinecraftServerPanel";

export const metadata: Metadata = {
  title: "Niños Rata Server | CLOUVA",
  description: "Mapa en vivo del servidor de Minecraft de CLOUVA.",
};

export default function NinosRataServerPage() {
  return <MinecraftServerPanel />;
}
