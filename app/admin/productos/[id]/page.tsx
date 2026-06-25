import ProductForm from "../nuevo/page-client";
export default async function EditProduct({ params }: { params: Promise<{ id: string }> }){const {id}=await params; return <ProductForm id={id}/>}
