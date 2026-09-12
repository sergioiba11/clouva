import type { Metadata } from "next";
import { PortfolioExperience } from "@/components/portfolio/PortfolioExperience";
import { PORTFOLIO_ASSETS } from "@/lib/portfolio/portfolio-data";

const description =
  "AI-native product builder based in Buenos Aires, building digital products across frontend, product design, cloud, AI systems and creative technology.";

export const metadata: Metadata = {
  metadataBase: new URL("https://clouva.com.ar"),
  title: "Sergio Ibañez — AI-Native Product Builder",
  description,
  alternates: {
    canonical: "/portafolio",
  },
  openGraph: {
    type: "website",
    url: "https://clouva.com.ar/portafolio",
    title: "Sergio Ibañez — AI-Native Product Builder",
    description,
    siteName: "CLOUVA",
    images: [
      {
        url: PORTFOLIO_ASSETS.hero,
        width: 1600,
        height: 900,
        alt: "Sergio Ibañez — CLOUVA portfolio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sergio Ibañez — AI-Native Product Builder",
    description,
    images: [PORTFOLIO_ASSETS.hero],
  },
};

export default function PortfolioPage() {
  return <PortfolioExperience />;
}
