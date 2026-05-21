import { RouteShell } from "@/components/route-shell";
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;return <RouteShell title={`Producto: ${slug}`} subtitle="Vista de producto con variantes/talles/colores lista para conectar."/>}
