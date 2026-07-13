import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Falta url" }, { status: 400 });

  try {
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: `fetch respondió ${res.status}` }, { status: 500 });
    const buf = Buffer.from(await res.arrayBuffer());

    const magic = buf.toString("utf8", 0, 4);
    if (magic !== "glTF") return NextResponse.json({ error: "No es un GLB válido", magic }, { status: 500 });

    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));

    const meshInfo = (json.meshes || []).map((mesh: any, i: number) => {
      const prims = mesh.primitives || [];
      const vertexCounts = prims.map((p: any) => {
        const accessorIdx = p.attributes?.POSITION;
        const accessor = json.accessors?.[accessorIdx];
        return { count: accessor?.count ?? 0, min: accessor?.min, max: accessor?.max };
      });
      return { index: i, name: mesh.name ?? null, primitives: vertexCounts };
    });

    const nodeInfo = (json.nodes || []).map((n: any, i: number) => ({
      index: i,
      name: n.name ?? null,
      meshIndex: n.mesh,
      translation: n.translation,
      scale: n.scale,
    }));

    return NextResponse.json({
      fileSizeBytes: buf.length,
      meshCount: (json.meshes || []).length,
      nodeCount: (json.nodes || []).length,
      animationCount: (json.animations || []).length,
      skinCount: (json.skins || []).length,
      meshInfo,
      nodeInfo,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error desconocido" }, { status: 500 });
  }
}
