# Running Story Studio

Turn running activity files into social graphics and animated videos.

**Import your run → design your story → export and share.**

- Import **GPX, TCX and FIT** files. The format is detected from the file contents, and parsing runs in a Web Worker.
- Review accurate statistics (with documented rules) and the GPS route. You can edit the title, location, distance and calories.
- Start from **7 data-driven templates**: Minimal, Sporty, Editorial, Dark Performance, Route Focus, Photo Overlay and Transparent Overlay.
- Edit in a **Canva-style layer editor**: drag, resize, rotate, snapping guides, layer list with drag reordering, show/hide, lock, rename, duplicate, copy/paste, align, z-order, and undo/redo backed by command history.
- Use your own **photos and videos** as backgrounds or layers. You can crop (zoom and pan), fit or fill, trim a video, and keep its audio.
- **Export images:** PNG, **transparent PNG** (the alpha channel is checked on the output), JPEG and WebP, at 1080×1920, 1080×1080, 2× or a custom size.
- **Export MP4 video:** the route draws itself and the statistics animate in. Frames are encoded in the browser with WebCodecs and muxed to MP4. If the browser can't produce MP4, you get a clearly labelled fallback.
- Projects are **saved in your browser** automatically. Optional **cloud sync** stores them in Cloudflare D1 + R2.

---

## 1. Architecture

```
Browser (React + TypeScript + Vite)                         Cloudflare
┌──────────────────────────────────────────────────┐        ┌─────────────────────────────┐
│ activity/  parse GPX·TCX·FIT (Web Worker), metrics│        │ Worker  worker/index.ts      │
│ route/     projection, simplification, partials   │  /api  │  - health, validate          │
│ design/    templates, layer factories             │◀──────▶│  - projects / templates CRUD │
│ editor/    command history (immer patches), geom. │        │  - media upload/download     │
│ render/    ONE Canvas renderer (preview = export) │        │  owner = SHA-256(device key) │
│ export/    image (PNG/alpha), video (WebCodecs+MP4│        ├─────────────────────────────┤
│ media/     validated uploads, element registry    │        │ D1: projects, activities,    │
│ projects/  IndexedDB store + cloud sync service   │        │     templates, media (meta)  │
└──────────────────────────────────────────────────┘        │ R2: activity tracks, media,  │
          shared/  design schema (zod) + migrations,          │     saved exports            │
                   API schemas, media sniffing                │ Static assets (SPA)          │
                                                              └─────────────────────────────┘
```

Key decisions:

- **One renderer.** `src/lib/render/renderer.ts` draws a versioned design document onto a Canvas 2D context. The editor preview, thumbnails, PNG export and every video frame all call it, so the preview and the exports can't drift apart. Selection handles are a separate DOM overlay and never get rendered into exports.
- **Deterministic animation.** Each layer's animation is a pure function of the timeline time `t`, never of the frame count or wall-clock time.
- **Media is processed in the browser.** Cloudflare Workers can't run FFmpeg or encode long videos. All rendering and encoding happens client-side. The Worker only handles metadata, authorization and storage. The video exporter sits behind one function (`exportVideo`), so an external renderer (for example Cloudflare Containers) could be added later without touching the editor.
- **Privacy by default.** Activity files never leave the browser unless cloud sync is turned on. The route layer can hide the first and last 200 m, 500 m or 1 km.
- **Storage separation.** D1 holds metadata and the design JSON. R2 holds the full activity tracks, uploaded media and saved exports. Binary data never goes into D1.

The design document schema lives in `shared/design.ts` (`DESIGN_SCHEMA_VERSION = 1`). Both the client and the Worker validate it with zod, and `migrateDesign()` upgrades older documents.

## 2. Features and status

| Area | Status |
| --- | --- |
| GPX import (tracks, routes, HR/cadence extensions) | ✅ tested |
| TCX import (laps, calories, device distance) | ✅ tested |
| FIT import (Garmin FIT SDK) | ✅ tested with a generated fixture; real-device files not yet in the test set |
| Metrics with documented rules ([docs/METRICS.md](docs/METRICS.md)) | ✅ tested against ground truth |
| 7 templates, story and square | ✅ all validate against the schema |
| Layer editor (move/resize/rotate/snap/reorder/lock/hide/rename/duplicate/copy-paste/align/undo-redo) | ✅ e2e tested |
| Layer types: text, statistic, route, shape, image, video, icon, chart (elevation/pace/HR); logo = image layer | ✅ |
| Group layers | ❌ not implemented |
| Map tiles behind the route | ❌ not implemented (route-only plus a privacy trim) |
| Photo and video backgrounds, crop/zoom/pan, video trim, audio | ✅ |
| PNG / transparent PNG / JPEG / WebP export | ✅ dimensions and alpha verified by decoding the PNG in tests |
| MP4 export (WebCodecs + mp4-muxer, H.264 → VP9 → AV1) | ✅ verified with ffprobe and a full ffmpeg decode (see limitations) |
| MediaRecorder fallback (MP4 if supported, else labelled WebM) | ⚠️ implemented, not covered by automated tests |
| Local projects (IndexedDB), personal templates | ✅ |
| Cloud sync (D1 + R2) incl. cross-device reopen | ✅ e2e tested against `wrangler dev` |

## 3. Project structure

```
shared/            design schema + migrations, API schemas, media magic-byte sniffing
worker/            Cloudflare Worker API (index.ts) and auth (auth.ts)
migrations/        D1 SQL migrations
src/lib/activity/  detect, gpx, tcx, fit, parse, import.worker, metrics, format, demo
src/lib/route/     projection, Douglas–Peucker simplification, partial paths
src/lib/design/    templates, layer factories, ids
src/lib/editor/    history (undo/redo), commands, geometry (hit-test, resize, snapping)
src/lib/render/    renderer, text layout, fonts (self-hosted), icons
src/lib/export/    image, video, capabilities, asset preparation
src/lib/media/     upload validation/storage, preview element registry
src/lib/projects/  IndexedDB, project/template service (local + cloud)
src/lib/cloud/     API client, device key, cloud health
src/ui/            pages (Landing, NewProject, EditorPage, Projects) and editor components
tests/             unit tests + fixtures;  worker-tests/ API tests (Miniflare)
e2e/               Playwright end-to-end tests
scripts/           make-fixtures.mjs
```

## 4. Cloudflare bindings and environment

`wrangler.jsonc`:

| Binding | Type | Purpose |
| --- | --- | --- |
| `ASSETS` | Static assets (`./dist`, SPA fallback) | The front end |
| `DB` | D1 database `running-story-studio` | Metadata and design JSON |
| `MEDIA` | R2 bucket `running-story-studio-media` (**private**) | Tracks, media, exports |
| `MAX_UPLOAD_BYTES` | var (default 90 MB) | Per-upload limit (Workers' request body limit is 100 MB on Free/Pro) |

No secrets are needed. Without D1/R2 the app still works fully in local-only mode, and `/api/health` reports storage as unavailable.

### Authentication

There are no accounts. The browser generates a random 256-bit **sync key** and sends it as `Authorization: Bearer`. The Worker stores only `SHA-256(key)` as `owner_id` and filters every query by it, so a project ID alone never grants access. Users can copy the key to another device on the Projects page. If you need real user accounts, put the app behind **Cloudflare Access** and derive `owner_id` from the verified Access JWT in `worker/auth.ts`.

## 5. D1 and R2 setup

```bash
npx wrangler login
npx wrangler d1 create running-story-studio          # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create running-story-studio-media   # keep it private (no public access)
npm run db:migrate:remote                            # applies migrations/0001_init.sql
```

## 6. Local development

```bash
npm install
npm run dev            # front end on http://localhost:5173 (local-only mode)

# full stack (Worker + local D1/R2 + built assets):
npm run build
npm run db:migrate:local
npx wrangler dev       # http://localhost:8787
# or keep Vite HMR and proxy /api to the Worker:  npm run dev:api  +  npm run dev
```

## 7. Deployment

```bash
npm run deploy         # vite build + wrangler deploy
```

## 8. Tests

```bash
npm run typecheck
npm test                       # unit + API tests (Vitest; API runs the Worker in Miniflare with D1/R2)
npm run test:e2e               # Playwright: import, editor, persistence, image + video export, mobile
E2E_CLOUD=1 E2E_BASE_URL=http://127.0.0.1:8787 npx playwright test e2e/cloud.spec.ts   # with wrangler dev running
```

The video e2e test checks the downloaded file with `ffprobe` (container, 1080×1920, 30/1 fps, exact frame count, duration, audio stream present) and decodes every frame with `ffmpeg -xerror`. Both need `ffmpeg` installed.

Results on the last run (Chromium 141, headless):

- Unit tests: 38 passed (activity parsing/metrics, editor history and commands, geometry, schema)
- API tests: 10 passed
- End-to-end: 7 passed (import, malformed files, editing + reload, image export, video export, cancel/retry, mobile)
- Cloud e2e: 1 passed (against `wrangler dev`)

## 9. Known limitations

- **H.264 depends on the browser.** Google Chrome, Edge and Safari normally have an H.264 encoder. Open-source Chromium builds (including Playwright's) don't. There the app makes an MP4 with **VP9 video and Opus audio** and warns that it may not play on iPhone or in Instagram. The H.264/AAC path is implemented but was **not verified in this environment**. Test it in Google Chrome before relying on it.
- **Firefox:** WebCodecs video encoding support varies by version. Without it, the app falls back to real-time recording and saves WebM when MP4 recording isn't available, labelled as WebM.
- **Video exports** are capped at 60 s and kept in memory while muxing (about 1–2 MB per second at 1080×1920). Background-video frames are fetched by seeking, so long clips export slowly. MP4 has no alpha channel, so transparent designs render over black.
- **HEIC photos** and **HEVC videos** are rejected or unplayable in most browsers. Convert them to JPEG/MP4 (H.264) first.
- **Browser storage** (IndexedDB) can be cleared by the browser or the user. Turn on cloud sync for durable storage.
- **Canvas size:** exports are limited to about 16.7 megapixels (Safari's canvas limit).
- **Uploads** go through the Worker so their content can be checked, which caps them at about 90 MB. Larger videos stay local-only.

## 10. Not done yet / next steps

1. Verify H.264 + AAC MP4 output in Google Chrome and Safari, and add a CI job using `channel: 'chrome'`.
2. Add real-device FIT/TCX samples (Garmin, Coros, Apple Watch exports) to the fixtures.
3. Group layers, map-tile backgrounds (with a provider and attribution), more chart styles.
4. Faster background-video decoding (WebCodecs `VideoDecoder` + demuxer instead of seeking).
5. Optional server-side renderer behind the `exportVideo` interface for unsupported browsers.
6. Cloudflare Access integration for account-based ownership.
