import { HomeExperience } from "@/components/clouva/HomeExperience";
import { serializeStructuredData } from "@/lib/seo/structured-data";
import "./home-desktop-viewport-fit.css";

const platformStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://clouva.com.ar/#website",
      url: "https://clouva.com.ar/",
      name: "CLOUVA",
      description: "CLOUVA es una plataforma creativa que conecta música, identidad, moda, 3D, Creator, Market, Mi Spot e inteligencia artificial en un mismo universo.",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://clouva.com.ar/#app",
      name: "CLOUVA",
      url: "https://clouva.com.ar/",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      isPartOf: { "@id": "https://clouva.com.ar/#website" },
      creator: { "@id": "https://clouva.com.ar/clouva#person" },
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeStructuredData(platformStructuredData) }}
      />
      <HomeExperience />
    </>
  );
}
