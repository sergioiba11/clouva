# Quesito — Discord Voice AI

Quesito is the voice bot for **Niños Rata Server**.

## What it does

- Joins a Discord voice channel with `/quesito entrar`.
- Listens for the wake word **“Quesito”**.
- Sends completed utterances to Google Cloud Speech-to-Text.
- Only forwards wake-word turns to Vertex AI.
- Answers through Google Cloud Text-to-Speech.
- Reads the live Minecraft status from `https://clouva.com.ar/api/minecraft/status`.
- Keeps only a short in-memory conversation history. Audio is not written to disk.
- Plays YouTube audio in the same Discord voice channel through Quesito.
- Accepts either a YouTube URL or a YouTube search in `/play`.
- Keeps an in-memory queue and supports pause, resume, skip, stop and volume.

## Discord commands

- `/quesito entrar`
- `/quesito salir`
- `/quesito silencio`
- `/quesito hablar`
- `/quesito estado`
- `/play youtube:<link o búsqueda>`
- `/pause`
- `/resume`
- `/skip`
- `/queue`
- `/stop`
- `/volume porcentaje:<0-200>`

## Runtime environment

Required:

- `DISCORD_BOT_TOKEN`
- `GOOGLE_CLOUD_PROJECT`

Optional:

- `DISCORD_GUILD_ID` — registers slash commands immediately in one server; otherwise commands are global.
- `VERTEX_LOCATION` — default `us-central1`.
- `VERTEX_MODEL` — default `gemini-2.5-flash` through Vertex AI.
- `QUESITO_WAKE_WORD` — default `quesito`.
- `CLOUVA_MINECRAFT_STATUS_URL` — default CLOUVA production Minecraft status endpoint.

## Privacy / family-server defaults

The service decodes an utterance after Discord marks the speaker as silent, transcribes it, and discards non-wake-word text. It does not persist raw voice recordings. Quesito's system prompt is constrained for a teen/family server.

## YouTube playback runtime

The container bundles the official Linux `yt-dlp` release plus `ffmpeg`, and runs a local BgUtils PO Token provider. YouTube extraction uses the `mweb` player client plus generated Proof-of-Origin tokens so Cloud Run egress is less likely to be rejected by YouTube's anti-bot checks.

Music never makes Quesito auto-join a channel by itself. `/play` is an explicit user action: if Quesito is not connected yet, it joins the invoking user's current voice channel.

While a track is playing, Quesito does not interrupt it with TTS. Voice conversation resumes normally after the music queue finishes or is stopped.

Deployment retry marker: 2026-09-20.
