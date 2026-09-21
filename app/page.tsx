import { HomeExperience } from "@/components/clouva/HomeExperience";
import "./home-desktop-viewport-fit.css";

const platformStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Brand",
      "@id": "https://clouva.com.ar/#brand",
      name: "CLOUVA",
      alternateName: "Clouva",
      url: "https://clouva.com.ar/",
      logo: "https://clouva.com.ar/assets/clouva/brand/logo-official-dark.png?v=official-20260907",
    },
    {
      "@type": "WebSite",
      "@id": "https://clouva.com.ar/#website",
      url: "https://clouva.com.ar/",
      name: "CLOUVA",
      alternateName: "Clouva",
      inLanguage: "es-AR",
      description: "CLOUVA es una plataforma creativa que conecta música, identidad, moda, 3D, Creator, Market, Mi Spot e inteligencia artificial en un mismo universo.",
      about: { "@id": "https://clouva.com.ar/#platform" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://clouva.com.ar/#platform",
      name: "CLOUVA",
      url: "https://clouva.com.ar/",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web, Android",
      inLanguage: "es-AR",
      isAccessibleForFree: true,
      description: "Plataforma creativa para música, identidad, moda, 3D, Creator, Market, Mi Spot e inteligencia artificial.",
      brand: { "@id": "https://clouva.com.ar/#brand" },
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(platformStructuredData).replace(/</g, "\\u003c") }}
      />
      <HomeExperience />
    </>
  );
}
