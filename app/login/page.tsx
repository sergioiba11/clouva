import { Suspense } from "react";
import { ClouvaBoot } from "@/components/clouva/ClouvaBoot";
import LoginContent from "./login-content";

export default function LoginPage() {
  return (
    <div
      className="fixed inset-0 h-[100dvh] overflow-y-auto overscroll-y-contain bg-[#05040a] touch-pan-y [-webkit-overflow-scrolling:touch]"
      data-login-scroll-root
    >
      <Suspense fallback={<ClouvaBoot showWorld subtitle="Abriendo tu acceso..." />}>
        <LoginContent />
      </Suspense>
    </div>
  );
}
