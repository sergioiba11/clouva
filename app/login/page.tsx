import { Suspense } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { LoginClient, LoginLoading } from "@/components/auth/login-client";

export default function LoginPage() {
  return (
    <main>
      <MainNav />
      <Suspense fallback={<LoginLoading />}>
        <LoginClient />
      </Suspense>
      <MainFooter />
    </main>
  );
}
