-- Definitive role fix: source of truth is profiles.role_v2

-- 1) Ensure role_v2 enum exists with new values
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_v3') THEN
    CREATE TYPE public.user_role_v3 AS ENUM ('admin','empleado','cliente','vip');
  END IF;
END $$;

-- 2) If role_v2 is still using old enum/user_role, convert safely to user_role_v3 values
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role_v2_new public.user_role_v3;

UPDATE public.profiles
SET role_v2_new = CASE
  WHEN COALESCE(role_v2::text, role::text) IN ('admin') THEN 'admin'::public.user_role_v3
  WHEN COALESCE(role_v2::text, role::text) IN ('employee','empleado') THEN 'empleado'::public.user_role_v3
  WHEN COALESCE(role_v2::text, role::text) IN ('vip') THEN 'vip'::public.user_role_v3
  ELSE 'cliente'::public.user_role_v3
END
WHERE role_v2_new IS NULL;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS role_v2;

ALTER TABLE public.profiles
  RENAME COLUMN role_v2_new TO role_v2;

ALTER TABLE public.profiles
  ALTER COLUMN role_v2 SET DEFAULT 'cliente'::public.user_role_v3,
  ALTER COLUMN role_v2 SET NOT NULL;

-- 3) Keep legacy role only for compatibility (admin=>admin, rest=>customer)
UPDATE public.profiles
SET role = CASE
  WHEN role_v2 = 'admin' THEN 'admin'::app_role
  ELSE 'customer'::app_role
END;

-- 4) Ensure admin user Sergio exists and stays admin
INSERT INTO public.profiles (id, email, full_name, avatar_url, role_v2, role)
SELECT
  au.id,
  au.email,
  COALESCE(NULLIF(au.raw_user_meta_data->>'full_name',''), split_part(au.email, '@', 1)),
  NULLIF(au.raw_user_meta_data->>'avatar_url',''),
  'admin'::public.user_role_v3,
  'admin'::app_role
FROM auth.users au
WHERE au.email = 'sergio.iba.11@gmail.com'
ON CONFLICT (id) DO UPDATE SET
  email = COALESCE(public.profiles.email, EXCLUDED.email),
  full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
  avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url),
  role_v2 = 'admin'::public.user_role_v3,
  role = 'admin'::app_role;

CREATE INDEX IF NOT EXISTS idx_profiles_role_v2 ON public.profiles(role_v2);
