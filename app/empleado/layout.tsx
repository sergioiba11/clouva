import { Suspense } from "react";
import EmpleadoLayoutClient from "./layout-client";

export default function EmpleadoLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div />}>
      <EmpleadoLayoutClient>{children}</EmpleadoLayoutClient>
    </Suspense>
  );
}
