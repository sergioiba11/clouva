import type { Metadata } from "next";
import { TrucoScoreboard } from "@/components/truco/TrucoScoreboard";

export const metadata: Metadata = {
  title: "Anotador de Truco | CLOUVA",
  description: "Anotador de truco argentino para llevar la partida desde CLOUVA.",
};

export default function TrucoPage() {
  return <TrucoScoreboard />;
}
