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

1. **URL Analysis (`POST /api/analyze`)**: The client submits a media URL. The server enforces strict SSRF protection (blocking private, loopback, metadata, and internal IPs/hostnames via DNS resolution) and extracts available formats and metadata (up to 50 playlist items).
2. **Job Queueing (`POST /api/download`)**: The client selects video quality or audio-only mode (or a playlist batch). The server assigns UUID identifiers + shared `batchId`/`batchTitle`, persists job state (`jobs/{id}.json` when `GCS_BUCKET` is set), and queues extraction.
3. **Real-Time Telemetry & Auto-Save (`GET /api/jobs/stream`, `/api/stats`, `/stats`)**: The server pushes progress over SSE (15s heartbeats, clean 45s reconnect ahead of proxy timeouts), tracks zero-PII aggregate metrics (`/api/stats`), and enables client-side File System Access API folder auto-save + sequential playlist saving.
4. **File Delivery & Cleanup (`GET /api/jobs/:id/file`)**: When `GCS_BUCKET` is configured, completed media is uploaded to `media/{id}/` and served via a short-lived V4 Signed URL `302` redirect (unbounded file size + HTTP Range resume + CORS for direct folder writes, `Cache-Control: no-store`). In standalone/Docker mode without `GCS_BUCKET`, files stream from disk with full `HTTP 206 Partial Content` and `HEAD` support. Artifacts are purged automatically after 2 hours (and via 1-day bucket lifecycle) or manual deletion (`DELETE /api/jobs/:id`).

## Cloud & Deployment Topology

- **Frontend Edge CDN**: Firebase Hosting (`apps/web/dist`) with security headers (`HSTS`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`), Workbox PWA routing (`navigateFallbackDenylist` excluding `/api/`), and `/api/**` rewrites to Cloud Run.
- **Backend Compute**: Google Cloud Run (`us-central1`) containerized service (`Dockerfile`) running Node.js 20, Python 3.12, `yt-dlp`, Deno, and `FFmpeg`.
- **Large-File Transfer & Shared State**: Google Cloud Storage (`GCS_BUCKET=bagback-download-media-prod`) for cross-instance job state, telemetry summary, and CORS-enabled Signed URL downloads.
- **Reliability & Monitoring**: Cloud Monitoring Uptime Check + email alert policies on `/api/health` (`yt-dlp`, disk, GCS readiness) plus weekly automated `yt-dlp` freshness checks and Cloud Run `stable` revision tagging.
- **Self-Hosted Option**: Single-command deployment via `docker compose up -d --build`.