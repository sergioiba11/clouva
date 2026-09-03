export type OnboardingStatus = "pending" | "exploring" | "player_created" | "published";

export function completedOnboardingDestination(status: string | null | undefined) {
  if (status === "published") return "/profile/edit";
  if (status === "player_created") return "/onboarding/instagram";
  return null;
}

export function shouldRedirectMissingPlayerToOnboarding(status: string | null | undefined) {
  return status !== "published" && status !== "player_created";
}

