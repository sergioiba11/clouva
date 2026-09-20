import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Storage } from "@google-cloud/storage";
import { createClient } from "@supabase/supabase-js";

const projectId = process.env.CLOUVA_VIDEO_PROJECT_ID?.trim();
const jobMode = process.env.CLOUVA_VIDEO_JOB_MODE?.trim() === "analyze" ? "analyze" : "render";
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
  if (jobMode === "analyze") {
    await supabase.from("video_projects").update({
      audio_analysis_status: "failed",
      audio_analysis_error: String(message).slice(0, 900),
    }).eq("id", projectId);
    return;
  }
  await supabase.from("video_projects").update({
    status: "failed",
    error_code: "render_failed",
    error_message: String(message).slice(0, 900),
  }).eq("id", projectId);
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] || 0;
}

async function analyzeAudio(workdir, audioPath) {
  const sampleRate = 8000;
  const frameSeconds = 0.02;
  const frameSamples = Math.round(sampleRate * frameSeconds);
  const pcmPath = path.join(workdir, "analysis.pcm");
  await run("ffmpeg", [
    "-y", "-i", audioPath,
    "-map", "0:a:0", "-ac", "1", "-ar", String(sampleRate),
    "-f", "s16le", pcmPath,
  ]);

  const pcm = await readFile(pcmPath);
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount < sampleRate) throw new Error("El audio es demasiado corto para analizar el flow.");

  const frameCount = Math.floor(sampleCount / frameSamples);
  const rawEnergy = new Array(frameCount).fill(0);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sumSquares = 0;
    const start = frame * frameSamples;
    const end = Math.min(sampleCount, start + frameSamples);
    for (let i = start; i < end; i += 1) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      sumSquares += sample * sample;
    }
    rawEnergy[frame] = Math.sqrt(sumSquares / Math.max(1, end - start));
  }

  const scale = percentile(rawEnergy, 0.95) || Math.max(...rawEnergy) || 1;
  const energy = rawEnergy.map((value) => clamp(value / scale));
  const onset = energy.map((value, index) => {
    if (!index) return 0;
    const from = Math.max(0, index - 4);
    let previous = 0;
    for (let i = from; i < index; i += 1) previous += energy[i];
    previous /= Math.max(1, index - from);
    return Math.max(0, value - previous);
  });

  const minLag = Math.max(1, Math.round(60 / (180 * frameSeconds)));
  const maxLag = Math.max(minLag + 1, Math.round(60 / (50 * frameSeconds)));
  let bestLag = Math.round(60 / (120 * frameSeconds));
  let bestScore = -1;
  let onsetPower = 0;
  for (const value of onset) onsetPower += value * value;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = lag; i < onset.length; i += 1) score += onset[i] * onset[i - lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bpm = 60 / (bestLag * frameSeconds);
  while (bpm < 75) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  const periodFrames = Math.max(1, Math.round(60 / (bpm * frameSeconds)));

  let phaseFrame = 0;
  let phaseScore = -1;
  for (let offset = 0; offset < periodFrames; offset += 1) {
    let score = 0;
    for (let i = offset; i < onset.length; i += periodFrames) score += onset[i];
    if (score > phaseScore) {
      phaseScore = score;
      phaseFrame = offset;
    }
  }

  const durationSeconds = sampleCount / sampleRate;
  const beatPeriod = 60 / bpm;
  const beatPhaseSeconds = phaseFrame * frameSeconds;
  const beats = [];
  for (let t = beatPhaseSeconds; t < durationSeconds; t += beatPeriod) beats.push(Number(t.toFixed(3)));
  const downbeats = beats.filter((_, index) => index % 4 === 0);

  const confidence = clamp(bestScore / Math.max(0.000001, onsetPower));
  const barSeconds = beatPeriod * 4;
  const sectionSeconds = Math.max(4, barSeconds * 4);
  const sections = [];
  for (let start = 0; start < durationSeconds; start += sectionSeconds) {
    const end = Math.min(durationSeconds, start + sectionSeconds);
    const first = Math.floor(start / frameSeconds);
    const last = Math.min(energy.length, Math.ceil(end / frameSeconds));
    let average = 0;
    for (let i = first; i < last; i += 1) average += energy[i];
    average /= Math.max(1, last - first);
    const normalized = clamp(average);
    sections.push({
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      energy: Number(normalized.toFixed(3)),
      label: normalized >= 0.68 ? "high" : normalized <= 0.34 ? "low" : "medium",
    });
  }

  const events = [];
  for (let index = 0; index < downbeats.length; index += 1) {
    const time = downbeats[index];
    const frame = Math.min(energy.length - 1, Math.max(0, Math.round(time / frameSeconds)));
    events.push({ time, type: "downbeat", strength: Number((energy[frame] || 0).toFixed(3)) });
  }
  for (let index = 1; index < sections.length; index += 1) {
    const delta = sections[index].energy - sections[index - 1].energy;
    if (delta >= 0.18) events.push({ time: sections[index].start, type: "drop", strength: Number(clamp(delta * 2.5).toFixed(3)) });
    if (delta <= -0.2) events.push({ time: sections[index].start, type: "break", strength: Number(clamp(Math.abs(delta) * 2.5).toFixed(3)) });
  }
  events.sort((a, b) => a.time - b.time);

  const waveformPoints = 160;
  const waveform = [];
  for (let point = 0; point < waveformPoints; point += 1) {
    const first = Math.floor((point / waveformPoints) * energy.length);
    const last = Math.max(first + 1, Math.floor(((point + 1) / waveformPoints) * energy.length));
    let peak = 0;
    for (let i = first; i < Math.min(last, energy.length); i += 1) peak = Math.max(peak, energy[i]);
    waveform.push(Number(peak.toFixed(3)));
  }

  return {
    version: 1,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    bpm: Number(bpm.toFixed(2)),
    confidence: Number(confidence.toFixed(3)),
    beatPhaseSeconds: Number(beatPhaseSeconds.toFixed(3)),
    beats,
    downbeats,
    waveform,
    sections,
    events,
  };
}

async function main() {
  const { data: project, error: projectError } = await supabase
    .from("video_projects")
    .select("id,user_id,title,aspect_ratio,target_duration_seconds,audio_storage_path,status,project_mode,visualizer_reactivity,audio_analysis_status,audio_analysis")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error("No se pudo recuperar el proyecto.");

  if (jobMode === "analyze") {
    if (!project.audio_storage_path) throw new Error("El proyecto no tiene audio master para analizar.");
    await supabase.from("video_projects").update({
      audio_analysis_status: "analyzing",
      audio_analysis_error: null,
    }).eq("id", project.id).eq("user_id", project.user_id);

    const workdir = await mkdtemp(path.join(tmpdir(), "clouva-audio-analysis-"));
    try {
      const audioExt = path.extname(project.audio_storage_path) || ".audio";
      const audio = path.join(workdir, `master${audioExt}`);
      await bucket.file(project.audio_storage_path).download({ destination: audio });
      const analysis = await analyzeAudio(workdir, audio);
      const { error: analysisError } = await supabase.from("video_projects").update({
        audio_analysis_status: "completed",
        audio_analysis: analysis,
        audio_analysis_error: null,
        target_duration_seconds: Math.max(4, Math.min(7200, Math.ceil(analysis.durationSeconds))),
      }).eq("id", project.id).eq("user_id", project.user_id);
      if (analysisError) throw new Error(`El audio se analizó pero no pudo persistirse: ${analysisError.message}`);
      process.stdout.write(JSON.stringify({ ok: true, mode: "analyze", projectId: project.id, analysis }) + "\n");
      return;
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

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

    let visualForFinal = visual;
    const analyzedBpm = Number(project.audio_analysis?.bpm || 0);
    const analyzedPhase = Number(project.audio_analysis?.beatPhaseSeconds || 0);
    if (project.project_mode === "visualizer" && analyzedBpm > 0) {
      const reactive = path.join(workdir, "visual-reactive.mp4");
      const reactivity = clamp(Number(project.visualizer_reactivity || 1), 0.25, 2);
      const amplitude = (0.012 + (0.016 * reactivity)).toFixed(5);
      const period = (60 / analyzedBpm).toFixed(6);
      const phase = analyzedPhase.toFixed(6);
      const wave = `((1+cos(2*PI*((t-${phase})/${period})))/2)`;
      const pulse = `(${wave}*${wave}*${wave}*${wave})`;
      const zoom = `(1+${amplitude}*${pulse})`;
      const filter = `scale=w=trunc(iw*${zoom}/2)*2:h=trunc(ih*${zoom}/2)*2:eval=frame,crop=${width}:${height}:(iw-${width})/2:(ih-${height})/2,fps=24`;
      await run("ffmpeg", [
        "-y", "-i", visual,
        "-an", "-vf", filter,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        reactive,
      ]);
      visualForFinal = reactive;
    }

    const final = path.join(workdir, "final.mp4");
    const analyzedDuration = Number(project.audio_analysis?.durationSeconds || 0);
    const finalDuration = project.project_mode === "visualizer" && analyzedDuration > 0
      ? Math.min(Number(project.target_duration_seconds), analyzedDuration)
      : Number(project.target_duration_seconds);
    if (project.audio_storage_path) {
      const audioExt = path.extname(project.audio_storage_path) || ".audio";
      const audio = path.join(workdir, `master${audioExt}`);
      await bucket.file(project.audio_storage_path).download({ destination: audio });
      await run("ffmpeg", [
        "-y", "-i", visualForFinal, "-i", audio,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "320k",
        "-t", String(finalDuration),
        "-movflags", "+faststart",
        final,
      ]);
    } else {
      await run("ffmpeg", [
        "-y", "-i", visualForFinal,
        "-c", "copy",
        "-t", String(finalDuration),
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
