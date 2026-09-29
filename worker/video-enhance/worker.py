import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

import requests
from google.cloud import storage

JOB_ID = os.environ.get("CLOUVA_VIDEO_ENHANCE_JOB_ID", "").strip()
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SERVICE_ROLE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
BUCKET_NAME = os.environ.get("CLOUVA_GENERATED_MEDIA_BUCKET", "clouva-generated-media").strip()
LTX_ROOT = Path(os.environ.get("LTX_ROOT", "/opt/LTX-Video"))

if not JOB_ID:
    raise RuntimeError("CLOUVA_VIDEO_ENHANCE_JOB_ID no está configurado.")
if not SUPABASE_URL or not SERVICE_ROLE:
    raise RuntimeError("Faltan credenciales server-side de Supabase.")

HEADERS = {
    "apikey": SERVICE_ROLE,
    "Authorization": f"Bearer {SERVICE_ROLE}",
    "Content-Type": "application/json",
}
def api_url():
    return f"{SUPABASE_URL}/rest/v1/video_enhance_jobs?id=eq.{JOB_ID}"

def get_job():
    response = requests.get(api_url() + "&select=*", headers=HEADERS, timeout=30)
    response.raise_for_status()
    rows = response.json()
    if not rows:
        raise RuntimeError("El trabajo Video AI no existe.")
    return rows[0]

def patch_job(values):
    headers = {**HEADERS, "Prefer": "return=minimal"}
    response = requests.patch(api_url(), headers=headers, data=json.dumps(values), timeout=30)
    response.raise_for_status()

def run(args, cwd=None):
    process = subprocess.run(
        [str(value) for value in args],
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.returncode != 0:
        raise RuntimeError(f"{args[0]} terminó con código {process.returncode}: {process.stderr[-5000:]}")
    return process.stdout
def probe_video(path):
    raw = run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json", path,
    ])
    payload = json.loads(raw)
    stream = payload["streams"][0]
    return {
        "width": int(stream["width"]),
        "height": int(stream["height"]),
        "duration": float(payload["format"]["duration"]),
    }

def output_dimensions(job, metadata):
    landscape = metadata["width"] >= metadata["height"]
    if job["output_resolution"] == "480p":
        return (832, 480) if landscape else (480, 832)
    return (1216, 704) if landscape else (704, 1216)

def pipeline_config(model):
    configs = {
        "ltxv-13b-0.9.8-distilled": "configs/ltxv-13b-0.9.8-distilled.yaml",
        "ltxv-2b-0.9.8-distilled": "configs/ltxv-2b-0.9.8-distilled.yaml",
    }
    return configs.get(model, configs["ltxv-13b-0.9.8-distilled"])
def build_prompt(job):
    locks = []
    if job.get("preserve_motion"):
        locks.append("Preserve the original movement timing, choreography and physical action.")
    if job.get("preserve_camera"):
        locks.append("Preserve the original camera motion, framing, lens direction and shot timing.")
    if job.get("preserve_subject"):
        locks.append("Preserve the subject identity, body proportions and defining details.")
    mode = job.get("mode", "balanced")
    mode_text = {
        "faithful": "Keep the transformation faithful to the source footage.",
        "balanced": "Balance source fidelity with the requested visual transformation.",
        "reimagine": "Reimagine the visual treatment while retaining the source choreography.",
    }[mode]
    return " ".join([job.get("prompt", "").strip(), mode_text, *locks]).strip()

def noise_scale(job):
    strength = max(0.0, min(1.0, float(job.get("transform_strength") or 0.45)))
    base = 0.04 + strength * 0.34
    if job.get("mode") == "faithful":
        base *= 0.72
    elif job.get("mode") == "reimagine":
        base *= 1.18
    return round(max(0.02, min(0.48, base)), 4)

def newest_mp4(folder):
    candidates = list(Path(folder).glob("*.mp4"))
    if not candidates:
        raise RuntimeError("LTX terminó sin producir un MP4.")
    return max(candidates, key=lambda p: p.stat().st_mtime)
def prepare_chunk(source, target, start_seconds, actual_seconds, width, height):
    model_seconds = 193 / 24
    pad_seconds = max(0.0, model_seconds - actual_seconds)
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,"
        f"fps=24,tpad=stop_mode=clone:stop_duration={pad_seconds:.6f}"
    )
    run([
        "ffmpeg", "-y", "-ss", f"{start_seconds:.6f}", "-t", f"{actual_seconds:.6f}",
        "-i", source, "-an", "-vf", vf, "-frames:v", "193",
        "-c:v", "libx264", "-preset", "fast", "-crf", "16",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", target,
    ])

def generate_chunk(job, source, out_dir, width, height, seed):
    args = [
        "python3", str(LTX_ROOT / "inference.py"),
        "--prompt", build_prompt(job),
        "--negative_prompt", job.get("negative_prompt") or "blurry, jittery, distorted",
        "--input_media_path", source,
        "--image_cond_noise_scale", str(noise_scale(job)),
        "--height", str(height),
        "--width", str(width),
        "--num_frames", "193",
        "--frame_rate", "24",
        "--seed", str(seed),
        "--pipeline_config", pipeline_config(job.get("model")),
        "--output_path", str(out_dir),
    ]
    run(args, cwd=str(LTX_ROOT))
    return newest_mp4(out_dir)
def concat_chunks(chunks, target, workdir):
    concat_file = Path(workdir) / "concat.txt"
    concat_file.write_text(
        "\n".join(f"file '{str(path).replace(chr(39), chr(39)+chr(92)+chr(39)+chr(39))}'" for path in chunks),
        encoding="utf-8",
    )
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file, "-c", "copy", target])

def finish_video(job, visual, source, target, trim_start, duration):
    fps = int(job.get("output_fps") or 24)
    video_args = ["-vf", f"fps={fps}"] if fps != 24 else []
    if job.get("preserve_audio"):
        run([
            "ffmpeg", "-y", "-i", visual, "-ss", f"{trim_start:.6f}", "-t", f"{duration:.6f}",
            "-i", source, "-map", "0:v:0", "-map", "1:a:0?", *video_args,
            "-c:v", "libx264", "-preset", "medium", "-crf", "17",
            "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", target,
        ])
    else:
        run([
            "ffmpeg", "-y", "-i", visual, *video_args,
            "-c:v", "libx264", "-preset", "medium", "-crf", "17",
            "-an", "-t", f"{duration:.6f}", "-movflags", "+faststart", target,
        ])

def upload_file(bucket, local_path, object_path, content_type):
    blob = bucket.blob(object_path)
    blob.upload_from_filename(str(local_path), content_type=content_type)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.patch()
def main():
    started = time.monotonic()
    job = get_job()
    if not job.get("source_storage_path"):
        raise RuntimeError("El trabajo no tiene video de entrada.")
    patch_job({"status": "processing", "progress": 5, "error_code": None, "error_message": None})

    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
    with tempfile.TemporaryDirectory(prefix="clouva-ltx-") as temp:
        workdir = Path(temp)
        source = workdir / "source.mp4"
        bucket.blob(job["source_storage_path"]).download_to_filename(str(source))
        metadata = probe_video(source)
        trim_start = max(0.0, float(job.get("trim_start_seconds") or 0))
        available = max(0.0, metadata["duration"] - trim_start)
        requested = job.get("trim_duration_seconds")
        duration = min(available, float(requested)) if requested else available
        if duration <= 0.05:
            raise RuntimeError("El recorte seleccionado no contiene video.")

        width, height = output_dimensions(job, metadata)
        chunk_seconds = 8.0
        count = max(1, math.ceil(duration / chunk_seconds))
        generated_chunks = []
        for index in range(count):
            offset = index * chunk_seconds
            actual = min(chunk_seconds, duration - offset)
            input_chunk = workdir / f"source-{index:04d}.mp4"
            prepare_chunk(source, input_chunk, trim_start + offset, actual, width, height)
            out_dir = workdir / f"ltx-{index:04d}"
            out_dir.mkdir()
            generated = generate_chunk(job, input_chunk, out_dir, width, height, int(job["seed"]) + index)
            trimmed = workdir / f"generated-{index:04d}.mp4"
            run([
                "ffmpeg", "-y", "-i", generated, "-t", f"{actual:.6f}",
                "-c:v", "libx264", "-preset", "fast", "-crf", "17",
                "-an", "-pix_fmt", "yuv420p", trimmed,
            ])
            generated_chunks.append(trimmed)
            patch_job({"progress": min(88, 10 + int(((index + 1) / count) * 78))})

        visual = workdir / "visual.mp4"
        concat_chunks(generated_chunks, visual, workdir)
        final = workdir / "final.mp4"
        finish_video(job, visual, source, final, trim_start, duration)
        thumbnail = workdir / "thumbnail.jpg"
        run(["ffmpeg", "-y", "-ss", "1", "-i", final, "-frames:v", "1", "-q:v", "2", thumbnail])
        patch_job({"progress": 94})
        prefix = f"video-enhance/{job['user_id']}/{job['id']}/output"
        final_object = f"{prefix}/final.mp4"
        thumb_object = f"{prefix}/thumbnail.jpg"
        upload_file(bucket, final, final_object, "video/mp4")
        upload_file(bucket, thumbnail, thumb_object, "image/jpeg")
        elapsed = round(time.monotonic() - started, 3)
        patch_job({
            "status": "completed",
            "progress": 100,
            "output_storage_path": final_object,
            "output_url": f"https://storage.googleapis.com/{BUCKET_NAME}/{final_object}",
            "thumbnail_storage_path": thumb_object,
            "thumbnail_url": f"https://storage.googleapis.com/{BUCKET_NAME}/{thumb_object}",
            "gpu_seconds": elapsed,
            "error_code": None,
            "error_message": None,
            "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        try:
            patch_job({
                "status": "failed",
                "error_code": "ltx_worker_failed",
                "error_message": str(exc)[:900],
            })
        finally:
            raise
