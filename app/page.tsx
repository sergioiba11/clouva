import { HomeExperience } from "@/components/clouva/HomeExperience";
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
      creator: { "@id": "https://clouva.com.ar/clouva#person" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://clouva.com.ar/#app",
      name: "CLOUVA",
      url: "https://clouva.com.ar/",
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web, Android",
      description: "Plataforma creativa para música, identidad, moda, 3D, Creator, Market, Mi Spot e inteligencia artificial.",
      creator: { "@id": "https://clouva.com.ar/clouva#person" },
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
