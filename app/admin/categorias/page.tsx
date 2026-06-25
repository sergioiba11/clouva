import { SimpleAdminCrud } from "@/components/admin/admin-crud";
export default function AdminCategories(){return <SimpleAdminCrud table="categories" title="Gestión de categorías" fields={["name","slug","image_url"]} bucket="categories"/>}
