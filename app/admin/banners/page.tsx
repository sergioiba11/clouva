import { SimpleAdminCrud } from "@/components/admin/admin-crud";
export default function AdminBanners(){return <SimpleAdminCrud table="banners" title="Gestión de banners" fields={["title","subtitle","image_url","sort_order"]} bucket="banners"/>}
