import { Suspense } from "react";
import RegisterContent from "./register-content";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-md px-4 py-16 text-white/80">Cargando...</div>}>
      <RegisterContent />
    </Suspense>
  );
}
