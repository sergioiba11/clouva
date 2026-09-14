import type { ReactNode } from "react";
import { GeneticsShell } from "@/components/genetics/GeneticsShell";

export default function GeneticsLayout({ children }: { children: ReactNode }) {
  return <GeneticsShell>{children}</GeneticsShell>;
}
