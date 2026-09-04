import { Suspense } from "react";
import LoginContent from "./login-content";

export default function LoginPage() {
  return (
    <div
      className="fixed inset-0 h-[100dvh] overflow-y-auto overscroll-y-contain bg-[#05040a] touch-pan-y [-webkit-overflow-scrolling:touch]"
      data-login-scroll-root
    >
      <Suspense fallback={<div className="mx-auto w-full max-w-md px-4 py-16 text-white/80">Cargando...</div>}>
        <LoginContent />
      </Suspense>
    </div>
  );
}
