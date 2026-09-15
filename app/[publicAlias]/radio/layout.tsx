import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ProfileRadioShell } from "@/components/radio/ProfileRadioShell";
import { resolvePublicProfileRadio } from "@/lib/server/profile-radio-data";
import "../../iglu/radio/radio.css";

export const dynamic = "force-dynamic";

export default async function PublicProfileRadioLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ publicAlias: string }>;
}) {
  const { publicAlias } = await params;
  const station = await resolvePublicProfileRadio(publicAlias).catch(() => null);
  if (!station) notFound();

  return <ProfileRadioShell station={station}>{children}</ProfileRadioShell>;
}
