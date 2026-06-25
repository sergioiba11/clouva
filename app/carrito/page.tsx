import { MainFooter, MainNav } from "@/components/layout";
import { CartView } from "@/components/store/cart-view";
export default function CartPage(){return <main><MainNav/><section className="mx-auto max-w-7xl px-4 py-14 md:px-8"><h1 className="mb-8 text-4xl font-semibold">Carrito</h1><CartView/></section><MainFooter/></main>}
