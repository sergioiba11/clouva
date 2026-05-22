import { Suspense } from "react";
import AuthCallbackContent from "./auth-callback-content";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
          <p className="text-white/80">Completando inicio de sesión...</p>
        </main>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
