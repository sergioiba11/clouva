import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rapafernalia — CLOUVA",
  description: "Rapafernalia en CLOUVA.",
};

export default function RapafernaliaPage() {
  return (
    <main
      style={{
        minHeight: "100svh",
        background:
          "radial-gradient(circle at 50% 18%, rgba(151, 36, 255, 0.22), transparent 34%), radial-gradient(circle at 50% 100%, rgba(111, 0, 255, 0.16), transparent 40%), #050505",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          width: "100%",
          maxWidth: 1180,
          padding: "22px 20px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxSizing: "border-box",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <a
          href="/"
          style={{
            color: "#fff",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.18em",
          }}
        >
          CLOUVA
        </a>
        <span
          style={{
            color: "rgba(255,255,255,.55)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Rapafernalia
        </span>
      </header>

      <section
        style={{
          width: "100%",
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 18px 72px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: "min(100%, 760px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: "min(92vw, 610px)",
              aspectRatio: "1 / 1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              filter: "drop-shadow(0 28px 70px rgba(124, 26, 255, .28))",
            }}
          >
            <img
              src="/assets/rapafernalia/rapafernalia-logo-oficial-transparente.png"
              alt="Rapafernalia"
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </div>

          <div
            style={{
              marginTop: 2,
              border: "1px solid rgba(174, 80, 255, .4)",
              background: "rgba(92, 15, 155, .16)",
              boxShadow: "0 0 28px rgba(145, 45, 255, .12) inset",
              borderRadius: 999,
              padding: "9px 15px",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#d7b4ff",
            }}
          >
            Tienda oficial
          </div>
        </div>
      </section>
    </main>
  );
}
