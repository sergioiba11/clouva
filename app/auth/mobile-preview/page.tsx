import { Suspense } from "react";
import MobilePreviewClient from "./mobile-preview-client";

export default function MobilePreviewPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#07060d]" />}>
      <MobilePreviewClient />
    </Suspense>
  );
}
