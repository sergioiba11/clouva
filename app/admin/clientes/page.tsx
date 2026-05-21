"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AdminUsers(){
  const [users, setUsers] = useState<Array<{id:string;email:string;role:string}>>([]);
  useEffect(()=>{supabase.from("profiles").select("id,email,role").then(({data})=>setUsers((data as any[])??[]));},[]);
  return <div className="panel p-6"><h2 className="text-xl">Usuarios</h2><ul className="mt-4 space-y-2">{users.map(u=><li key={u.id}>{u.email} · {u.role}</li>)}</ul></div>;
}
