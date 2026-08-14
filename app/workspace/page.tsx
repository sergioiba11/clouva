import type { Metadata } from "next";
import { OfficialWorkspace } from "@/components/workspace/OfficialWorkspace";

export const metadata: Metadata = {
  title: "CLOUVA Workspace",
  description: "Workspace oficial de CLOUVA con producción protegida, preview aislada y Analyzer Lab cloud.",
};

export default function WorkspacePage() {
  return <OfficialWorkspace />;
}
