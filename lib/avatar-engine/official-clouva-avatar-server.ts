type OfficialAvatarClient = {
  from: (table: string) => any;
};

export type OfficialClouvaAvatarSource =
  | "admin_user_avatar"
  | "admin_profile"
  | "environment";

export type OfficialClouvaAvatar = {
  id: string;
  adminUserId: string | null;
  url: string;
  source: OfficialClouvaAvatarSource;
  updatedAt: string | null;
};

function normalizeHttpUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * CLOUVA is the creator/guide avatar shared by the whole platform.
 * The currently active avatar of an admin is the published global version.
 * Users reference it as a starter/AI companion; it is never copied over or
 * treated as their personal avatar.
 */
export async function resolveOfficialClouvaAvatar(
  supabase: OfficialAvatarClient,
): Promise<OfficialClouvaAvatar> {
  const { data: adminProfiles, error: adminError } = await supabase
    .from("profiles")
    .select("id,avatar_3d_url,updated_at")
    .eq("role", "admin")
    .order("updated_at", { ascending: false })
    .limit(25);

  if (adminError) {
    throw new Error(`No se pudo consultar el avatar oficial de CLOUVA: ${adminError.message}`);
  }

  const profiles = Array.isArray(adminProfiles) ? adminProfiles : [];
  const adminIds = profiles
    .map((profile: any) => String(profile?.id ?? "").trim())
    .filter(Boolean);

  if (adminIds.length) {
    const { data: activeAvatar, error: avatarError } = await supabase
      .from("user_avatars")
      .select("id,user_id,model_url,updated_at")
      .in("user_id", adminIds)
      .eq("is_active", true)
      .eq("status", "ready")
      .not("model_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (avatarError) {
      throw new Error(`No se pudo consultar el avatar activo del admin: ${avatarError.message}`);
    }

    const activeUrl = normalizeHttpUrl(activeAvatar?.model_url);
    if (activeAvatar?.id && activeUrl) {
      return {
        id: String(activeAvatar.id),
        adminUserId: String(activeAvatar.user_id),
        url: activeUrl,
        source: "admin_user_avatar",
        updatedAt: activeAvatar.updated_at ? String(activeAvatar.updated_at) : null,
      };
    }
  }

  for (const profile of profiles) {
    const profileUrl = normalizeHttpUrl(profile?.avatar_3d_url);
    if (!profileUrl) continue;
    return {
      id: `admin-profile-${String(profile.id)}`,
      adminUserId: String(profile.id),
      url: profileUrl,
      source: "admin_profile",
      updatedAt: profile.updated_at ? String(profile.updated_at) : null,
    };
  }

  const environmentUrl = normalizeHttpUrl(process.env.CLOUVA_OFFICIAL_AVATAR_URL);
  if (environmentUrl) {
    return {
      id: "clouva-official-environment",
      adminUserId: null,
      url: environmentUrl,
      source: "environment",
      updatedAt: null,
    };
  }

  throw new Error(
    "No hay un avatar oficial de CLOUVA publicado. El admin debe activar un avatar listo o configurar profiles.avatar_3d_url.",
  );
}
