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
- Opens Discord's official **Watch Together** Activity from `/play`.
- Keeps YouTube playback inside Discord's embedded YouTube player instead of extracting audio from Cloud Run.
- Sends the selected YouTube URL next to the Activity invite so the host can paste it into the synchronized Watch Together queue.

## Discord commands

- `/quesito entrar`
- `/quesito salir`
- `/quesito silencio`
- `/quesito hablar`
- `/quesito estado`
- `/play youtube:<link>`

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

Quesito does not extract or restream YouTube media. `/play` creates an invite for Discord's official Watch Together embedded application (application ID `880218394199220334`) in the invoking user's voice channel and posts the YouTube URL alongside it.

Playback, synchronization, queue controls, pause/seek and volume are handled inside Watch Together by Discord/YouTube.

Deployment retry marker: 2026-09-21.
