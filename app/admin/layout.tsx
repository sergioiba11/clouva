import { Suspense } from "react";
import AdminLayoutClient from "./layout-client";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div />}>
      <AdminLayoutClient>{children}</AdminLayoutClient>
    </Suspense>
  );
}
