import { Suspense } from "react";
import NuevoProductoClient from "./page-client";

export default function Page() {
  return (
    <Suspense fallback={<div />}>
      <NuevoProductoClient />
    </Suspense>
  );
}
