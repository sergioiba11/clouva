"use client";

import { useEffect } from "react";

export function ClouvaQrEngineEventBridge() {
  useEffect(() => {
    const openQrEngine = () => {
      const launcher = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("QR CLOUVA"));
      launcher?.click();
    };

    window.addEventListener("clouva:open-qr-engine", openQrEngine);
    return () => window.removeEventListener("clouva:open-qr-engine", openQrEngine);
  }, []);

  return null;
}
