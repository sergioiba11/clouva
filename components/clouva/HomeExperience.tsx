"use client";

import dynamic from "next/dynamic";

const AvatarScene = dynamic(() => import("@/components/clouva/AvatarScene").then((mod) => mod.AvatarScene), {
  ssr: false,
  loading: () => <main className="clouva-experience" aria-hidden="true" />,
});

export function HomeExperience() {
  return <AvatarScene />;
}
