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

1. **URL Analysis (`POST /api/analyze`)**: The client submits a media URL. The server validates the URL and extracts available video/audio formats and metadata.
2. **Job Queueing (`POST /api/download`)**: The client selects the target quality or audio-only mode. The server creates a unique job ID, persists job state (`jobs/{id}.json` when `GCS_BUCKET` is set), and starts an asynchronous extraction process.
3. **Real-Time Telemetry (`GET /api/jobs/stream`)**: The server pushes live progress percentages (`0%` to `100%`) over Server-Sent Events (SSE) with 15s heartbeats and clean 45s reconnect cycles ahead of reverse-proxy timeouts, hydrating state from shared storage across instances.
4. **File Delivery & Cleanup (`GET /api/jobs/:id/file`)**: When `GCS_BUCKET` is configured, completed media is uploaded to `media/{id}/` and served via a short-lived V4 Signed URL `302` redirect (unbounded file size + HTTP Range resume, `Cache-Control: no-store`). In standalone/Docker mode without `GCS_BUCKET`, files stream from disk with full `HTTP 206 Partial Content` and `HEAD` support. Artifacts are purged automatically after 2 hours (and via 1-day bucket lifecycle) or manual deletion (`DELETE /api/jobs/:id`).

## Cloud & Deployment Topology

- **Frontend Edge CDN**: Firebase Hosting (`apps/web/dist`) with Workbox PWA routing (`navigateFallbackDenylist` excluding `/api/`) and `/api/**` rewrites to Cloud Run.
- **Backend Compute**: Google Cloud Run (`us-central1`) containerized service (`Dockerfile`) running Node.js 20, Python 3.12, `yt-dlp`, Deno, and `FFmpeg`.
- **Large-File Transfer & Shared State**: Optional Google Cloud Storage bucket (`GCS_BUCKET`) for cross-instance job state and direct browser downloads via V4 Signed URLs.
- **Self-Hosted Option**: Single-command deployment via `docker compose up -d --build`.