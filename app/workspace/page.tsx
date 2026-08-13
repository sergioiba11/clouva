import type { Metadata } from "next";
import { OfficialWorkspace } from "@/components/workspace/OfficialWorkspace";

export const metadata: Metadata = {
  title: "CLOUVA Workspace",
  description: "Workspace oficial para mejorar CLOUVA Web y perfeccionar el Analyzer en un entorno separado.",
};

export default function WorkspacePage() {
  return <OfficialWorkspace />;
}
