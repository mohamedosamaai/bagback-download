# Component Hierarchy

This page details the UI component architecture, state ownership, and component relationships in the **`apps/web`** application.

---

## 1. UI Component Tree

The web client is built as a modular component hierarchy. The layout is optimized to handle bilingual transitions and strict type-safety:

```mermaid
graph LR
  Root[index.html / main.tsx] --> App[App Component]
  
  App --> Header[Header Component]
  Header --> ThemeToggle[Theme Switcher]
  Header --> LangToggle[Language Selector]
  
  App --> InputWrapper[URL Paste Input Card]
  App --> ErrorBanner[Error Alerts]
  
  App --> AnalyzeCard[AnalyzeResultCard]
  AnalyzeCard --> MediaPreview[Preview Header]
  AnalyzeCard --> OptionChips[Video / Audio Toggles]
  AnalyzeCard --> QualityGrid[Quality Profile Selector]
  
  App --> QueueList[Active Queue List]
  QueueList --> JobCard[JobCard Component]
  JobCard --> ProgressBar[Progress Bar Fill]
  JobCard --> DownloadAction[Simulated file download]
  JobCard --> Dropbox[DropboxSaver Integration]
  
  App --> LocalHistory[LocalHistory Grid]
  App --> Footer[Footer Component]
  Footer --> LegalModals[InfoModal: Terms, Privacy, Code]
```

---

## 2. Component Design Specifications

- **`App` (State Controller)**: Owns global hooks for languages, styling classes, pasted input values, active jobs payload, local storage indices, and modal overlay variables.
- **`Header`**: Holds controls for theme (light/dark class injections) and language selectors (RTL direction mapping).
- **`AnalyzeResultCard`**: Handles selection of audio extractors or specific video resolutions. Uses caching to display thumbnails.
- **`JobCard`**: Monitors download progress. For static showcases, it generates standard in-browser text blobs to allow users to verify the downloader logic offline.
- **`DropboxSaver`**: Connects dynamically to the Dropbox Drop-ins API.
- **`InfoModal`**: Renders dynamic text panels based on the requested policy (Terms of Service, Privacy Policy, or Clean-Room engineering statement).
