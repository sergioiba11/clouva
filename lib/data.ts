export type Category = "Hoodies"|"Remeras"|"Gorras"|"Mochilas"|"Stickers"|"Parches"|"Accesorios";

export type Product = {id:string;slug:string;name:string;price:number;category:Category;stock:number;images:string[];description:string;sizes:string[];colors:string[];featured?:boolean;drop?:string};

export const categories: Category[] = ["Hoodies","Remeras","Gorras","Mochilas","Stickers","Parches","Accesorios"];

export const products: Product[] = [
{id:"1",slug:"hoodie-shadow-core",name:"Shadow Core Hoodie",price:89990,category:"Hoodies",stock:8,images:["https://images.unsplash.com/photo-1521572163474-6864f9cf17ab"],description:"Hoodie techwear premium, corte urbano, interior térmico ligero.",sizes:["S","M","L","XL"],colors:["Black","Violet"],featured:true,drop:"DROP 07"},
{id:"2",slug:"remera-live-different",name:"Live Different Tee",price:44990,category:"Remeras",stock:19,images:["https://images.unsplash.com/photo-1503342217505-b0a15ec3261c"],description:"Remera oversize streetwear con gráfica CLOUVA.",sizes:["S","M","L"],colors:["Black","White"],featured:true},
{id:"3",slug:"gorra-night-grid",name:"Night Grid Cap",price:39990,category:"Gorras",stock:22,images:["https://images.unsplash.com/photo-1521369909029-2afed882baee"],description:"Gorra estructurada con bordado minimal premium.",sizes:["U"],colors:["Black"],drop:"DROP 07"},
{id:"4",slug:"mochila-southside-rig",name:"Southside Rig Backpack",price:99990,category:"Mochilas",stock:5,images:["https://images.unsplash.com/photo-1491637639811-60e2756cc1c7"],description:"Mochila modular con estética techwear funcional.",sizes:["U"],colors:["Black","Cyan"]},
{id:"5",slug:"patch-os-humano",name:"Patch OS Humano",price:9990,category:"Parches",stock:60,images:["https://images.unsplash.com/photo-1512436991641-6745cdb1723f"],description:"Parche bordado edición Vida de Flows.",sizes:["U"],colors:["Violet"]}
];

export const adminStats = [
  { label: "Ventas hoy", value: "$ 1.290.000", delta: "+12%" },
  { label: "Ventas mes", value: "$ 18.420.000", delta: "+28%" },
  { label: "Pedidos pendientes", value: "14", delta: "-4" },
  { label: "Stock bajo", value: "6", delta: "+1" }
];
