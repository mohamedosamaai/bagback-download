# Data Flow & Sequence

This page outlines the end-to-end data lifecycle of a download session, including analysis metadata parsing, state hydration, error management, and SSE progress updates.

---

## 1. Request Lifecycle Overview

The execution sequence is split depending on whether **Mock Mode** or **Live Mode** is active:

1. **Analyze Stage**:
   - The user inputs a URL.
   - The system validates the URL structure.
   - Metadata (title, duration, channel name, and resolution tables) is extracted.
2. **Download Stage**:
   - The user triggers the download options.
   - A download job is pushed to the queue.
   - Progress increments are monitored dynamically via Server-Sent Events (SSE) or client-side background timer handlers.
   - The physical file is streamed to the user or cached in local storage.

---

## 2. Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  actor User as End User
  participant Client as React App (Vite)
  participant Service as api client (lib/api)
  participant Server as Express Server
  participant Engine as yt-dlp

  User->>Client: Inputs URL and clicks Analyze
  Client->>Service: analyze(url)
  alt Mock Mode Active
    Service-->>Client: Returns mock metadata (1s delay)
  else Live Mode Active
    Service->>Server: POST /api/analyze {url}
    Server->>Engine: Spawn --dump-json
    Engine-->>Server: JSON standard output
    Server-->>Service: Returns AnalyzeResult payload
    Service-->>Client: Hydrates presentation state
  end
  Client->>User: Displays media card and formats selector

  User->>Client: Chooses resolution and clicks Start
  Client->>Service: download(opts)
  alt Mock Mode Active
    Service-->>Client: Returns simulated Job ID
    loop Simulates SSE stream
      Service-->>Client: Triggers updates (queued -> running -> completed)
    end
  else Live Mode Active
    Service->>Server: POST /api/download {url, format, audioOnly}
    Server-->>Service: Returns active Job ID
    Service->>Server: Establishes GET /api/jobs/stream (SSE)
    loop Progress monitoring
      Server->>Engine: Spawn download with output monitoring
      Engine-->>Server: Prints progress percentages
      Server-->>Service: Pushes job list payload (SSE broadcast)
      Service-->>Client: Refreshes state and progress bar
    end
  end
  Client->>User: Displays download links and Dropbox options
```

---

## 3. Error Handling Protocol

- **Validation Failures**: Invalid URLs trigger immediate client-side error blocks without touching the backend server or mock generators.
- **Extraction Failures**: If `yt-dlp` fails to parse a link, the Express server falls back to querying a verified proxy pool before returning a `422 Unprocessable Entity` status.
- **Session Failures**: If a download job fails mid-process, it is marked as `failed` with the error description appended to the payload.
