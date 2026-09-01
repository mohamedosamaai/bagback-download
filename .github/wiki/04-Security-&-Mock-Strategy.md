# Security & Mock Strategy

This page documents the configurations, environmental variables, mock fallback mechanisms, and security structures in **Bagback Download**.

---

## 1. Zero-Secret Architecture

To support deployment to public showcase repositories, we follow a strict zero-leak design pattern:
- **Client Keys**: Public integration tokens (e.g., Dropbox App Keys) are fetched from `import.meta.env.VITE_DROPBOX_APP_KEY`. No raw keys are allowed in source code.
- **Server Ports and Directories**: Path configs, temp storage paths, and network ports are initialized from `process.env`.
- **CORS Constraints**: Origin access headers are configurable in `.env` to avoid open CORS vulnerability issues in production.

---

## 2. Interactive Mock Strategy

To enable static previews on hosting providers (Vercel, GitHub Pages, StackBlitz) without requiring a running node/python backend, we implement a client-side mock framework:

- **Service Swapping**: We implement a unified `DownloadService` interface. The app determines which subclass to instantiate on startup:
  - `RealDownloadService`: Makes fetch calls to the Node.js Express server.
  - `MockDownloadService`: Uses localized timer intervals to simulate server jobs.
- **Trigger Metrics**: Mock mode activates automatically under the following conditions:
  - The URL contains `?mock=true`.
  - `import.meta.env.VITE_USE_MOCKS` is set to `'true'`.
  - The hostname indicates a preview environment (e.g., `*.github.io`, `*.vercel.app`, `*.stackblitz.io`).

```mermaid
graph TD
  subgraph ClientSandbox [User Browser Sandbox]
    AppCode[React App Logic] -->|Checks Runtime| DetectMock{Mock Triggered?}
    DetectMock -->|Yes| MockSvc[MockDownloadService]
    DetectMock -->|No| RealSvc[RealDownloadService]
    
    MockSvc -->|Loads/Saves| LocalStorage[(localStorage Memory)]
    MockSvc -->|Simulates SSE| Timeouts[setInterval / progress loops]
    MockSvc -->|Offline Downloads| LocalBlobs[In-memory file blobs]
  end

  subgraph ServerSandbox [Server Environment]
    RealSvc -->|Fetch REST API| Express[Express Route Listeners]
    Express -->|Read Env| ProcessEnv[process.env variables]
    Express -->|Temporary Cache| TempFolder[/tmp/bagback-downloads]
  end
```

---

## 3. Data Storage & Local Storage Security

- **No Cookies**: The client does not write cookies or inject persistent tracking.
- **History Logs**: Previous download listings are saved locally via `localStorage` on the user's browser, preventing server-side logging of media URLs.
- **Mock Jobs**: If mock mode is active, active and completed jobs are saved inside browser memory under the key `bagback-mock-jobs` so they persist through page reloads.
