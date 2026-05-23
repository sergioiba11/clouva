import { Suspense } from "react";
import FlowLayoutClient from "./layout-client";

export default function FlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div />}>
      <FlowLayoutClient>{children}</FlowLayoutClient>
    </Suspense>
  );
}
