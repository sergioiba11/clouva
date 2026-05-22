import { Suspense } from "react";
import CarritoClient from "./CarritoClient";

export default function CarritoPage() {
  return (
    <Suspense fallback={<div />}>
      <CarritoClient />
    </Suspense>
  );
}
