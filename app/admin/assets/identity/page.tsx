import { AssetIdentityAssignment } from "@/components/admin/assets/AssetIdentityAssignment";

type SearchValue = string | string[] | undefined;

type Props = {
  searchParams: Promise<Record<string, SearchValue>>;
};

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AdminAssetIdentityPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <AssetIdentityAssignment
      source={first(params.source)}
      bucket={first(params.bucket)}
      path={first(params.path)}
      name={first(params.name)}
    />
  );
}
