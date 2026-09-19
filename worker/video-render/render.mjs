import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Storage } from "@google-cloud/storage";
import { createClient } from "@supabase/supabase-js";

const projectId = process.env.CLOUVA_VIDEO_PROJECT_ID?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const bucketName = process.env.CLOUVA_GENERATED_MEDIA_BUCKET?.trim() || "clouva-generated-media";

if (!projectId) throw new Error("CLOUVA_VIDEO_PROJECT_ID no está configurado.");
if (!supabaseUrl || !serviceRole) throw new Error("Faltan credenciales server-side de Supabase.");

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const storage = new Storage();
const bucket = storage.bucket(bucketName);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} terminó con código ${code}: ${stderr.slice(-4000)}`));
    });
  });
}

async function fail(message) {
  await supabase.from("video_projects").update({
    status: "failed",
    error_code: "render_failed",
    error_message: String(message).slice(0, 900),
  }).eq("id", projectId);
}

async function main() {
  const { data: project, error: projectError } = await supabase
    .from("video_projects")
    .select("id,user_id,title,aspect_ratio,target_duration_seconds,audio_storage_path,status")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error("No se pudo recuperar el proyecto.");

  const { data: clips, error: clipsError } = await supabase
    .from("media_generation_jobs")
    .select("id,sequence_index,status,duration_seconds,output_storage_path")
    .eq("project_id", project.id)
    .eq("type", "video")
    .order("sequence_index", { ascending: true });
  if (clipsError || !clips?.length) throw new Error("El proyecto no tiene clips.");
  if (clips.some((clip) => clip.status !== "completed" || !clip.output_storage_path)) {
    throw new Error("Hay clips que todavía no están completos.");
  }

  const plannedSeconds = clips.reduce((sum, clip) => sum + Number(clip.duration_seconds || 0), 0);
  if (plannedSeconds < Number(project.target_duration_seconds)) {
    throw new Error("El timeline visual no cubre la duración objetivo.");
  }

  const workdir = await mkdtemp(path.join(tmpdir(), "clouva-video-"));
  try {
    const [width, height] = project.aspect_ratio === "9:16" ? [1080, 1920] : [1920, 1080];
    const normalized = [];

    for (let index = 0; index < clips.length; index += 1) {
      const source = path.join(workdir, `source-${String(index).padStart(4, "0")}.mp4`);
      const target = path.join(workdir, `clip-${String(index).padStart(4, "0")}.mp4`);
      await bucket.file(clips[index].output_storage_path).download({ destination: source });
      await run("ffmpeg", [
        "-y", "-i", source,
        "-an",
        "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24`,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        target,
      ]);
      normalized.push(target);
    }

    const concatFile = path.join(workdir, "concat.txt");
    await writeFile(concatFile, normalized.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"));
    const visual = path.join(workdir, "visual.mp4");
    await run("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c", "copy",
      "-t", String(project.target_duration_seconds),
      visual,
    ]);

    const final = path.join(workdir, "final.mp4");
    if (project.audio_storage_path) {
      const audioExt = path.extname(project.audio_storage_path) || ".audio";
      const audio = path.join(workdir, `master${audioExt}`);
      await bucket.file(project.audio_storage_path).download({ destination: audio });
      await run("ffmpeg", [
        "-y", "-i", visual, "-i", audio,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "320k",
        "-t", String(project.target_duration_seconds),
        "-movflags", "+faststart",
        final,
      ]);
    } else {
      await run("ffmpeg", [
        "-y", "-i", visual,
        "-c", "copy",
        "-t", String(project.target_duration_seconds),
        "-movflags", "+faststart",
        final,
      ]);
    }

    const thumbnail = path.join(workdir, "thumbnail.jpg");
    await run("ffmpeg", [
      "-y", "-ss", "1", "-i", final,
      "-frames:v", "1", "-q:v", "2",
      thumbnail,
    ]);

    const renderPrefix = `video-projects/${project.user_id}/${project.id}/renders`;
    const finalObject = `${renderPrefix}/final.mp4`;
    const thumbnailObject = `${renderPrefix}/thumbnail.jpg`;
    await bucket.upload(final, {
      destination: finalObject,
      metadata: { contentType: "video/mp4", cacheControl: "public, max-age=31536000, immutable" },
    });
    await bucket.upload(thumbnail, {
      destination: thumbnailObject,
      metadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    });

    const outputUrl = `https://storage.googleapis.com/${bucketName}/${finalObject}`;
    const thumbnailUrl = `https://storage.googleapis.com/${bucketName}/${thumbnailObject}`;
    const { error: updateError } = await supabase.from("video_projects").update({
      status: "completed",
      progress: 100,
      output_storage_path: finalObject,
      output_url: outputUrl,
      thumbnail_storage_path: thumbnailObject,
      thumbnail_url: thumbnailUrl,
      error_code: null,
      error_message: null,
      completed_at: new Date().toISOString(),
    }).eq("id", project.id).eq("user_id", project.user_id);
    if (updateError) throw new Error(`El render terminó pero no pudo registrarse: ${updateError.message}`);

    process.stdout.write(JSON.stringify({ ok: true, projectId: project.id, outputUrl }) + "\n");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[clouva-video-render]", message);
  await fail(message).catch(() => {});
  process.exitCode = 1;
});
