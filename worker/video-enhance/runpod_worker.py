import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

import requests
import runpod
from runpod.serverless import VolumeCache

LTX_ROOT = Path(os.environ.get("LTX_ROOT", "/opt/LTX-Video"))
HF_CACHE = os.environ.get("HF_HOME", "/root/.cache/huggingface")


def run(args, cwd=None):
    process = subprocess.run(
        [str(value) for value in args],
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.returncode != 0:
        raise RuntimeError(
            f"{args[0]} terminó con código {process.returncode}: {process.stderr[-5000:]}"
        )
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


def output_dimensions(payload, metadata):
    landscape = metadata["width"] >= metadata["height"]
    if payload.get("output_resolution") == "480p":
        return (832, 480) if landscape else (480, 832)
    return (1216, 704) if landscape else (704, 1216)


def build_prompt(payload):
    locks = []
    if payload.get("preserve_motion", True):
        locks.append("Preserve the original movement timing, choreography and physical action.")
    if payload.get("preserve_camera", True):
        locks.append("Preserve the original camera motion, framing, lens direction and shot timing.")
    if payload.get("preserve_subject", True):
        locks.append("Preserve the subject identity, body proportions and defining details.")

    mode = payload.get("mode", "balanced")
    mode_text = {
        "faithful": "Keep the transformation faithful to the source footage.",
        "balanced": "Balance source fidelity with the requested visual transformation.",
        "reimagine": "Reimagine the visual treatment while retaining the source choreography.",
    }.get(mode, "Balance source fidelity with the requested visual transformation.")
    return " ".join([str(payload.get("prompt", "")).strip(), mode_text, *locks]).strip()


def noise_scale(payload):
    strength = max(0.0, min(1.0, float(payload.get("transform_strength") or 0.45)))
    base = 0.04 + strength * 0.34
    if payload.get("mode") == "faithful":
        base *= 0.72
    elif payload.get("mode") == "reimagine":
        base *= 1.18
    return round(max(0.02, min(0.48, base)), 4)


def newest_mp4(folder):
    candidates = list(Path(folder).glob("*.mp4"))
    if not candidates:
        raise RuntimeError("LTX terminó sin producir un MP4.")
    return max(candidates, key=lambda p: p.stat().st_mtime)


def download_source(url, target):
    with requests.get(url, stream=True, timeout=(30, 3600)) as response:
        response.raise_for_status()
        with open(target, "wb") as output:
            for chunk in response.iter_content(chunk_size=8 * 1024 * 1024):
                if chunk:
                    output.write(chunk)


def upload_resumable_session(url, path, content_type):
    size = Path(path).stat().st_size
    with open(path, "rb") as source:
        response = requests.put(
            url,
            data=source,
            headers={
                "Content-Type": content_type,
                "Content-Length": str(size),
                "Content-Range": f"bytes 0-{size - 1}/{size}",
            },
            timeout=(30, 3600),
        )
    response.raise_for_status()


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


def generate_chunk(payload, source, out_dir, width, height, seed):
    args = [
        "python3", str(LTX_ROOT / "inference.py"),
        "--prompt", build_prompt(payload),
        "--negative_prompt", payload.get("negative_prompt") or "blurry, jittery, distorted",
        "--input_media_path", source,
        "--image_cond_noise_scale", str(noise_scale(payload)),
        "--height", str(height),
        "--width", str(width),
        "--num_frames", "193",
        "--frame_rate", "24",
        "--seed", str(seed),
        "--pipeline_config", "configs/ltxv-2b-0.9.8-distilled.yaml",
        "--output_path", str(out_dir),
    ]
    run(args, cwd=str(LTX_ROOT))
    return newest_mp4(out_dir)


def concat_chunks(chunks, target, workdir):
    concat_file = Path(workdir) / "concat.txt"
    lines = []
    for path in chunks:
        escaped = str(path).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    concat_file.write_text("\n".join(lines), encoding="utf-8")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_file, "-c", "copy", target])


def finish_video(payload, visual, source, target, trim_start, duration):
    fps = int(payload.get("output_fps") or 24)
    video_args = ["-vf", f"fps={fps}"] if fps != 24 else []
    if payload.get("preserve_audio", True):
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


def process(payload):
    required = [
        "source_url",
        "output_upload_url",
        "thumbnail_upload_url",
        "output_storage_path",
        "thumbnail_storage_path",
        "output_url",
        "thumbnail_url",
        "prompt",
    ]
    missing = [key for key in required if not payload.get(key)]
    if missing:
        raise ValueError(f"Faltan campos requeridos: {', '.join(missing)}")

    if payload.get("model") not in (None, "ltxv-2b-0.9.8-distilled"):
        raise ValueError("Este worker Runpod acepta únicamente LTXV 2B Distilled.")

    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="clouva-runpod-ltx-") as temp:
        workdir = Path(temp)
        source = workdir / "source.mp4"
        download_source(payload["source_url"], source)

        metadata = probe_video(source)
        trim_start = max(0.0, float(payload.get("trim_start_seconds") or 0))
        available = max(0.0, metadata["duration"] - trim_start)
        requested = payload.get("trim_duration_seconds")
        duration = min(available, float(requested)) if requested else available
        if duration <= 0.05:
            raise ValueError("El recorte seleccionado no contiene video.")

        width, height = output_dimensions(payload, metadata)
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
            generated = generate_chunk(
                payload,
                input_chunk,
                out_dir,
                width,
                height,
                int(payload.get("seed") or 171198) + index,
            )
            trimmed = workdir / f"generated-{index:04d}.mp4"
            run([
                "ffmpeg", "-y", "-i", generated, "-t", f"{actual:.6f}",
                "-c:v", "libx264", "-preset", "fast", "-crf", "17",
                "-an", "-pix_fmt", "yuv420p", trimmed,
            ])
            generated_chunks.append(trimmed)

        visual = workdir / "visual.mp4"
        concat_chunks(generated_chunks, visual, workdir)
        final = workdir / "final.mp4"
        finish_video(payload, visual, source, final, trim_start, duration)

        thumbnail = workdir / "thumbnail.jpg"
        thumb_at = min(1.0, max(0.0, duration / 2))
        run([
            "ffmpeg", "-y", "-ss", str(thumb_at), "-i", final,
            "-frames:v", "1", "-q:v", "2", thumbnail,
        ])

        upload_resumable_session(payload["output_upload_url"], final, "video/mp4")
        upload_resumable_session(payload["thumbnail_upload_url"], thumbnail, "image/jpeg")

    elapsed = round(time.monotonic() - started, 3)
    return {
        "output_storage_path": payload["output_storage_path"],
        "thumbnail_storage_path": payload["thumbnail_storage_path"],
        "output_url": payload["output_url"],
        "thumbnail_url": payload["thumbnail_url"],
        "gpu_seconds": elapsed,
    }


def handler(job):
    payload = job.get("input") or {}
    try:
        with VolumeCache(dirs=[HF_CACHE]):
            return process(payload)
    except Exception as exc:
        raise RuntimeError(str(exc)[:1500]) from exc


runpod.serverless.start({"handler": handler})
