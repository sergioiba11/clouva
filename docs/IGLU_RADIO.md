# IGLÚ RADIO

## Runtime

`/iglu/radio` uses a nested persistent layout. `RadioProvider`, `PersistentAudioEngine`, `RadioHeader` and `PersistentRadioPlayer` live above child routes, so internal App Router navigation only replaces `{children}`.

There is exactly one HTML audio element, rendered by `components/iglu-radio/PersistentAudioEngine.tsx`.

## Stream

The official stream is intentionally not hardcoded.

Configure it in the web runtime/build environment:

```bash
NEXT_PUBLIC_IGLU_RADIO_STREAM_URL=https://your-official-stream.example/live
```

When the variable is empty, IGLÚ RADIO stays navigable and reports `OFFLINE` / `SIN TRANSMISIÓN` instead of inventing a live signal.

## Signal states

- `IDLE`
- `CONNECTING`
- `LIVE`
- `OFFLINE`
- `ERROR`

`LIVE` is only set from the audio element's `playing` event.

## Metadata

Audio transport and metadata are separate. `RadioProvider` owns the current metadata snapshot so a future Icecast/Shoutcast/Supabase/SSE/WebSocket adapter can update title, artist, program, host and artwork without recreating the audio element.

## Media Session

When supported by the browser, the provider publishes metadata to `navigator.mediaSession` and registers `play` / `pause` handlers.

## Validation

`tests-iglu-radio.mjs` locks the persistence contract: one audio engine above child routes, no hard reload navigation, configurable stream, and real signal states.
