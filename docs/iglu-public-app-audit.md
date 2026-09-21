# IGLÚ Records public app — canonical reuse audit

Date: 2026-09-21

## Scope

The public IGLÚ surface stays inside CLOUVA at `/lamatrix/estudios/eliglurecords`. The implementation must reuse canonical CLOUVA identities and data instead of creating parallel Player, calendar, commerce, reservation, location, or radio models.

## Canonical systems already present

| Public IGLÚ capability | Canonical CLOUVA source |
| --- | --- |
| Studio identity | `studios` + `spaces.legacy_studio_id` + `public_slug_aliases` |
| Studio Players | `player_studios` + `players` |
| Public Player profile | `resolvePlayerAlias()` and root route `/[publicAlias]` |
| Current user's Player | authenticated `GET /api/players/me` |
| Player location | `players.location`, `players.latitude`, `players.longitude` |
| Studio / Player calendars | `agendas`, `agenda_events`, `agenda_event_agendas`, `agenda_event_participants` |
| Availability / blocking | `agenda_availability_rules`, `agenda_blocks` |
| Reservations | `bookings` linked to `studio_services` and `agenda_event_id` |
| Studio services | `studio_services` |
| Merch products | `commerce_products`, `commerce_product_variants`, `commerce_product_publications` |
| Cart / checkout | existing CLOUVA store/cart components and commerce checkout |
| Radio / audio | `radio_station_settings`, `radio_tracks`, `radio_playlists`, `profile_radio_settings` |
| Music provider links | `player_music_connections` + existing YouTube connection UI |
| Realtime | Supabase realtime can subscribe to canonical tables; no mirror tables are required |

## Current IGLÚ production state

- Canonical Studio: `el-iglu`, public alias `eliglurecords`.
- Canonical Space: active public Studio space linked through `legacy_studio_id`.
- Public Studio members are already sourced from `player_studios`; do not hardcode names such as Joyze.
- The IGLÚ Space has a default Agenda. It is the calendar to expose publicly.
- Availability rules are currently empty, so the UI must not invent free hours.
- The Studio currently has no active `studio_services`; therefore a real booking cannot be confirmed until a real service is published.
- IGLÚ Radio exists as a public profile-radio configuration, but currently has no stream URL and no radio tracks. The public Media/Live UI must show an honest offline/empty state.
- Commerce has real published data for the IGLÚ Studio. The home Merch carousel must use only those real product/gallery images.

## Routing contract

- Home: `/lamatrix/estudios/eliglurecords`
- Media / Live: `/lamatrix/estudios/eliglurecords/media`
- Booking discovery: `/lamatrix/estudios/eliglurecords/reservar`
- Unified calendar: `/lamatrix/estudios/eliglurecords/agenda`
- Store: `/lamatrix/estudios/eliglurecords/tienda`
- Current-user public Player: `/lamatrix/estudios/eliglurecords/perfil` resolves to the canonical `/{player.slug}`
- IGLÚ Players directory: existing `/iglu/artistas`

## Guardrails

- Never display synthetic ratings, addresses, availability, streams, products, or Players.
- Do not create a second calendar or second profile for a person.
- If a capability has no production data, render an actionable empty state.
- Booking confirmation must be disabled until a real active Studio service and a real available slot exist.
- Kick visual streaming must not be represented as connected until a supported integration/configuration exists.
