# Firmware Integration Requirements — consuming the OpenSprinkler-Weather contract

> **What this is:** a verified specification of exactly what the OpenSprinkler-Firmware must support to consume the OpenSprinkler-Weather service contract (provider-fallback, per-plant Kc, water-budget Kc, /v1 API, MQTT+HA, rain-restriction consolidation). It records both implemented producer behavior and the matching firmware parser/scheduler behavior.

## Actors & boundary
- **Weather service** (this repo): emits the legacy `&key=value` watering response and, optionally, the `/v1` JSON API and MQTT topics.
- **Firmware** (`C:\Dev\OpenSprinkler-Firmware`): polls `GET /<method>?loc=&wto=&fwv=` and parses the flat response in `getweather_callback`; the watering scale drives `IOPT_WATER_PERCENTAGE` (station runtime × wl/100).
- **MQTT/HA**: service → broker → Home Assistant. The firmware has its own independent `mqtt.cpp`; the service's MQTT does not target the firmware.

---

## P0 — Backward-compatible consumption (verified: works **today, no firmware change required**, subject to the producer-side `rawData` size limit)

**FR-P0.1 — Tolerate new cross-cutting keys.** The firmware parser is key-pull, not schema validation: `getweather_callback` (`weather.cpp:54`) calls `findKeyVal` only for known keys (`errCode/scale/restricted/sunrise/sunset/eip/tz/rd/rawData/scales`). The service's new fields (`skip`, `skipReason`, `pwsBypassed`, `pwsBypassReason`) live **inside the `rawData` JSON blob**, not as top-level keys, and are stored opaquely in `wt_rawData`. **Verified:** unknown content does not break the parser. *Required capability: none new — the existing key-pull parser already satisfies this.*

**FR-P0.2 — Honor `scale=0`.** Weather-skips and the (now-unified) bit-7 rain restriction produce `scale=0`. Firmware accepts `0` (range 0–250), writes `IOPT_WATER_PERCENTAGE=0` (`weather.cpp:72`), and scheduling multiplies by `wl/100` → no station queued (`main.cpp:886/915`). **Verified end-to-end: skip → scale 0 → no watering, no firmware change.**

**⚠️ FR-P0.3 (HARD LIMIT — guarded on the weather-service side) — `rawData` ≤ 319 bytes.** `findKeyVal` truncates/ignores a `rawData` value longer than `TMP_BUFFER_SIZE-1 = 319` bytes (`defines.h:31`). `convertToLegacyFormat` now removes verbose optional reason fields when the serialized object approaches 300 bytes (`routes/weather.ts:224-230`), and the firmware contract test exercises oversized skip/fallback reasons plus the dense WaterBudget observability shape (`test/firmware-contract.spec.ts:71-109`). **Ongoing requirement:** preserve this conservative `<319`-byte guard whenever fields or methods are added; otherwise firmware silently drops the entire `rawData` value.

**FR-P0.4 — Emit top-level `restricted` (implemented and guarded).** When the firmware restriction bit is set and the unified rain-skip rule fires, `computeWateringDecision` sets `restricted=true`; the legacy response maps it to top-level `restricted=1` in addition to `scale=0` (`routes/weather.ts:378`, `routes/weather.ts:415`, `routes/weather.ts:430-432`, `routes/weather.ts:552-560`). `convertToLegacyFormat` preserves that field (`routes/weather.ts:234-235`), and `test/firmware-contract.spec.ts` pins its optional `0/1` wire shape. The firmware parses it into `wt_restricted`, forces `wl=0` only for weather-enabled programs, and exposes `wtrestr` through `/jc` (`weather.cpp:82-86`, `main.cpp:905-920`, `opensprinkler_server.cpp:1281-1291`). Its per-program notification path uses each matched program's own queued state and supplies the restriction flag only when that skipped program has `use_weather`, so another program in the same minute cannot hide the skip and an unrelated non-weather skip is not mislabeled (`main.cpp:924-967`).

---

## P1 — Optional `/v1` JSON adoption (firmware changes required; non-AVR only)

**NFR-P1.1 — HTTPS/JSON per target.** Non-AVR targets already have TLS (`SUPPORT_HTTPS`: ESP `WiFiClientSecure`, Linux/OSPi `EthernetClientSsl`) and bundle ArduinoJson (used today for `wto`). **AVR has no real TLS** (`https://` is stripped, sends plain HTTP — `weather.cpp:189/227`). **Requirement:** `/v1` adoption is **ESP/Linux-only**; AVR stays on the legacy flat contract.

**FR-P1.2 — JSON response path.** Today weather responses are parsed flat; `/v1` returns JSON. Adoption requires: a JSON client/parser path for the weather response (ArduinoJson is present), URL/param building for `/v1/watering?loc=&method=&restrict=`, mapping `{scale, rainDelay, skip, skipReason, pwsBypassed, weatherProvider, reason}` onto the existing `os` fields, and **HTTP status-code handling** (200 vs 400/404/422/502 + `{error:{code,message}}`) replacing the `errCode` convention.

**FR-P1.2a — `/v1/watering` time-field superset (implemented).** So a single `/v1/watering` call covers the **full** firmware effect-contract (not just the watering decision), the response **additively** carries the OS-encoded time fields the legacy flat response also emitted: `tz` (0–108), `sunrise`/`sunset` (0–1440 local minutes), `eip` (external IP as int). These are encoded identically to the legacy path (`getOsTimeFields` → `getTimezone`/`ipToInt`, `routes/weather.ts`) and shaped by `shapeWateringResponse(decision, time)` (`routes/api/shapers.ts`). Pinned by `test/firmware-contract.spec.ts` ("/v1 watering superset guard") and `routes/v1/v1.spec.ts`. Note: `/v1/weather` stays clean (display-only); the time superset lives only on `/v1/watering`. `scales` is intentionally **not** carried (the service no longer emits multi-day scales). The firmware `/v1` adapter maps `scale→IOPT_WATER_PERCENTAGE`, `rainDelay→rd`, `restricted→wt_restricted`, `tz/sunrise/sunset/eip→` their legacy targets; success/failure derives from HTTP status (no body `errCode`).

**NFR-P1.3 — Response must fit `ETHER_BUFFER`.** HTTP read is capped at `ETHER_BUFFER_SIZE` = 2048 (AVR/ESP) / 16384 (OSPi) (`defines.h:359/474`). `/v1/budget` history can be large → the firmware must request a small `limit=` (or the service must default small). Plain `/v1/watering` + `/v1/weather` fit comfortably.

---

## P2 — MQTT / Home Assistant (no firmware change)

**Confirmed boundary:** the service's retained topics (`<prefix>/<deviceId>/{availability,watering,weather,budget,status}`) + HA discovery + LWT are **service → broker → HA**. The firmware's own `mqtt.cpp` is independent and publishes the controller's state. **No firmware capability required**; do not couple the two MQTT paths.

---

## Edge cases (verified)
- **Weather fetch fails / `errCode != 0`:** only `errCode==0` updates `checkwt_success_lasttime` and applies `scale`/`scales` (`weather.cpp:65`). After a success-timeout, Zimmerman/ETo reset `wl=100` and clear weather state (`main.cpp:1218`); manual/auto-rain-delay/monthly do not. **Edge:** if there was *never* a successful weather call, the timeout-reset path doesn't run — the controller uses its default `wl`. The service's **fail-open** behavior (no scale change when weather is unavailable) is compatible with this.
- **`scales` array (14-day interval scales):** firmware supports `md_scales` (up to 14 days, used for interval programs when `mda==100`) and exposes `wls` in `/jc` (`weather.cpp:141`, `main.cpp:891`). The service does **not** emit `scales` → this firmware capability is **dormant**, not broken. (Monthly is separate: `wto.scales[12]` → `wt_monthly`.)
- **`rd` (rain delay):** firmware honors top-level `rd` (`weather.cpp:127`) — start/stop rain delay. The service emits `rd` from the adjustment response; unchanged.

---

## Requirements checklist
- [x] P0 backward-compat **verified** against the real parser (no firmware change for skip/scale-0/new keys)
- [x] P0 `rawData` size limit protected by conservative trimming and firmware-contract tests
- [x] P0 top-level `restricted` emission implemented and contract-tested, lighting up firmware restriction status and correctly attributed per-program notifications
- [x] P1 `/v1` adoption capabilities scoped (non-AVR HTTPS+JSON, status codes, buffer fit)
- [x] P2 MQTT boundary confirmed (no firmware change)
- [x] Failsafe/edge behavior characterized

## Out of scope
New implementation work; firmware refactors (see `firmware-definition.md`); changing the adjustment-method math; multi-zone `scales` revival; AVR HTTPS.

## Recommended next actions (weather-service side, low-risk)
1. **Keep the `rawData` guard comprehensive** as fields or methods are added: exercise each worst-case legacy shape and preserve the conservative `<319`-byte bound (FR-P0.3).
2. Treat `/v1` firmware adoption as a **firmware-repo** project (non-AVR), using the seam from `firmware-definition.md`.

---
*Integration verification + spec — 🔴 Codex (firmware code-grounded, adversarial completeness) · 🔵 Claude (parser verification + synthesis). Firmware refs at `C:\Dev\OpenSprinkler-Firmware`.*
