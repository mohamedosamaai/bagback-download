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
2. **Job Queueing (`POST /api/download`)**: The client selects the target quality or audio-only mode. The server creates a unique job ID and starts an asynchronous extraction process.
3. **Real-Time Telemetry (`GET /api/jobs/stream`)**: The server pushes live progress percentages (`0%` to `100%`) to connected clients over Server-Sent Events (SSE).
4. **File Delivery & Cleanup (`GET /api/jobs/:id/file`)**: Once completed, the file is streamed directly to the user's device and purged automatically by the scheduled cleanup job or manual deletion (`DELETE /api/jobs/:id`).

## Cloud & Deployment Topology

- **Frontend Edge CDN**: Firebase Hosting (`apps/web/dist`) with automatic `/api/**` rewrites to Cloud Run.
- **Backend Compute**: Google Cloud Run containerized service (`Dockerfile`) running Node.js 20, Python 3.12, `yt-dlp`, Deno, and `FFmpeg`.
- **Self-Hosted Option**: Single-command deployment via `docker compose up -d --build`.