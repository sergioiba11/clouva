import { Suspense } from "react";
import LoginContent from "./login-content";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-md px-4 py-16 text-white/80">Cargando...</div>}>
      <LoginContent />
    </Suspense>
  );
}
