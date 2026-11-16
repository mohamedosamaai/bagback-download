# Architecture

Bagback Download is structured as a modular TypeScript monorepo deployed across Firebase Hosting and Google Cloud Run, with full support for standalone Docker containers.

## Monorepo Workspaces

### `apps/web`
Progressive Web Application (PWA) built with React, Vite, and TypeScript. Supports full Arabic (RTL) and English (LTR) localization, real-time Server-Sent Events (SSE) progress updates, local download history, and optional Dropbox integration. Deployed globally via **Firebase Hosting**.

### `apps/server`
Node.js and Express API server managing media metadata analysis, download job orchestration, SSE progress broadcasting, rate limiting, and automatic temporary file cleanup. Powered by `yt-dlp` and `FFmpeg` inside an isolated runtime container deployed on **Google Cloud Run** (or self-hosted via Docker).

### `apps/extension`
Manifest V3 browser extension for Chrome, Edge, and Chromium browsers enabling one-click media forwarding from context menus or the active tab directly to the web application.

### `packages/core`
Shared TypeScript interfaces, job status models (`Job`, `JobStatus`, `FormatInfo`), and domain contracts used across the frontend and backend workspaces.

### `packages/downloader-engine`
URL validation and engine adapter utilities shared across workspace packages.

## Request & Data Flow

1. **URL Analysis (`POST /api/analyze`)**: The client submits a media URL. The server enforces strict SSRF protection (blocking private, loopback, metadata, and internal IPs/hostnames via DNS resolution) and extracts available formats and metadata (up to 50 playlist items), with `curl_cffi` Chrome TLS impersonation fallback and direct media URL detection.
2. **Job Queueing & Control (`POST /api/download`, `/pause`, `/resume`, `/retry`)**: The client selects video quality or audio-only mode (or a playlist batch). The server assigns UUID identifiers + shared `batchId`/`batchTitle` and `mediaType`, persists job state (`jobs/{id}.json` when `GCS_BUCKET` is set), and supports live Pause/Resume (`yt-dlp --continue`) and Retry.
3. **Real-Time Telemetry, Filter Tabs & Archive (`GET /api/jobs/stream`, `/api/stats`, `/api/jobs/:id/archived`)**: The server pushes progress over SSE, tracks zero-PII aggregate metrics (`/api/stats`), and moves device-saved items to a short 15-minute server archive (`ARCHIVED_MAX_AGE_MS`) before automatic purge to minimize GCS cost.
4. **Single File & Whole-Playlist ZIP Delivery (`GET /api/jobs/:id/file`, `GET /api/batches/:batchId/zip`)**: Completed files and full 50-track playlist ZIP archives (streamed in `STORE` mode via `zipStream.ts` directly into GCS) are served via short-lived V4 Signed URL `302` redirects (unbounded size + Range resume + CORS, `Cache-Control: no-store`). Artifacts purge in 15 minutes after save/archival or after 2 hours max.

## Cloud & Deployment Topology

- **Frontend Edge CDN**: Firebase Hosting (`apps/web/dist`) with security headers (`HSTS`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), Workbox PWA routing (`navigateFallbackDenylist` excluding `/api/`), and `/api/**` rewrites to Cloud Run.
- **Backend Compute**: Google Cloud Run (`us-central1`) containerized service (`Dockerfile`) running Node.js 20, Python 3.12, `yt-dlp`, Deno, and `FFmpeg`.
- **Large-File Transfer & Shared State**: Google Cloud Storage (`GCS_BUCKET=bagback-download-media-prod`) for cross-instance job state, telemetry summary, and CORS-enabled Signed URL downloads.
- **Reliability & Monitoring**: Cloud Monitoring Uptime Check + email alert policies on `/api/health` (`yt-dlp`, disk, GCS readiness) plus weekly automated `yt-dlp` freshness checks and Cloud Run `stable` revision tagging.
- **Self-Hosted Option**: Single-command deployment via `docker compose up -d --build`.