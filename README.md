<div align="center">
  <!-- Typing animation matching the cyber-violet design theme -->
  <a href="https://github.com/mohamedosamaai"><img src="https://readme-typing-svg.demolab.com/?font=Outfit&amp;size=24&amp;pause=1000&amp;color=C084FC&amp;center=true&amp;vCenter=true&amp;width=600&amp;lines=Welcome+to+Bagback+Download+Showcase!;Universal+Media+and+File+Download+Manager;Architected+by+Mohamed+Osama" alt="Typing SVG" /></a>

  <br>

  <!-- Subtitle / Focus areas -->
  <p align="center">
    <b>Enterprise-Grade • Open-Source • Universal Media &amp; File Download Manager</b>
  </p>

  <!-- Badge Hub -->
  <p align="center">
    <a href="https://github.com/mohamedosamaai/bagback-download-showcase/actions">
      <img src="https://img.shields.io/badge/CI%2FCD-PASSING-success?style=for-the-badge&amp;logo=githubactions&amp;logoColor=white" alt="CI/CD Status" />
    </a>
    <a href="https://github.com/mohamedosamaai/bagback-download-showcase/security">
      <img src="https://img.shields.io/badge/SECURITY-HARDENED-blue?style=for-the-badge&amp;logo=github&amp;logoColor=white" alt="Security Hardened" />
    </a>
    <a href="https://github.com/mohamedosamaai/bagback-download-showcase/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/LICENSE-MIT-yellow?style=for-the-badge" alt="License MIT" />
    </a>
    <a href="https://github.com/sponsors/mohamedosamaai">
      <img src="https://img.shields.io/badge/SPONSOR-SUPPORT_PROJECT-ff69b4?style=for-the-badge&amp;logo=githubsponsors&amp;logoColor=white" alt="Sponsor" />
    </a>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&amp;logo=react&amp;logoColor=white" alt="React 19" />
    <img src="https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&amp;logo=vite&amp;logoColor=white" alt="Vite 6" />
    <img src="https://img.shields.io/badge/TypeScript-Strict-3178c6?style=for-the-badge&amp;logo=typescript&amp;logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&amp;logo=express&amp;logoColor=white" alt="Express" />
    <img src="https://img.shields.io/badge/Docker-Ready-2496ed?style=for-the-badge&amp;logo=docker&amp;logoColor=white" alt="Docker" />
  </p>

  <hr width="50%">
</div>

# Bagback Download Showcase 🚀

**An Enterprise-Grade, Open-Source Universal Media & File Download Manager**

Architected with precision by **Mohamed Osama**  
*Digital Transformation Architect (DDT) & Founder @ Bagback Digital Solutions*

---

## 🌟 Executive System Overview

**Bagback Download Showcase** is a modern, high-performance universal file and media manager. It solves common web bottlenecks by offering a robust, self-hosted solution to securely extract and download media from numerous global video platforms, streaming services, and media engines, leveraging the full capability of `yt-dlp`.

Designed strictly for **Security and Privacy**, this showcase repository demonstrates how to manage background downloading securely. It utilizes native binary integrations and real-time Server-Sent Events (SSE) while keeping operations strictly in-memory and temporary storage, ensuring no residual data retention.

## 🏗️ Architectural & Technical Highlights

This project utilizes a modern monorepo layout dividing operations into clean application targets:

- **Clean Architecture & Folder Isolation**:
  - `apps/web/` - React 19 + Vite frontend application, offering a responsive, accessible, and RTL-compliant UI with real-time download status integration.
  - `apps/server/` - Robust Express.js backend that orchestrates the execution of `yt-dlp` binaries, streams progress via SSE to connected clients, and securely cleans up post-download.
  - `packages/core/` - Reusable domain models, type definitions, and protocol standards.
  - `packages/downloader-engine/` - Shared downloader engine utilities and execution abstractions.
- **Real-Time Job Tracking (SSE)**: The backend exposes Server-Sent Events endpoints for seamless, zero-polling real-time updates directly to the client UI.
- **Robust Security Practices**: 
  - Dynamic CORS whitelist enforcement.
  - Strict Rate Limiting on API and file operations.
  - Strict URL hostname parsing and validation to prevent SSRF and injection vectors.
  - Restricted temporary directory file permissions (`0o700`) and comprehensive path traversal protection.
- **i18n Translation & RTL/LTR Compliance**: Supports seamless switching between Arabic and English with full bidirectional typography support.

---

## 🚀 Quickstart Guide (Local Development)

### Prerequisites
- Node.js (v20+)
- Python 3+ (For `yt-dlp` integration)
- FFmpeg (Installed on system PATH for media merging/conversion)

### 1. Project Initialization
```bash
# Clone the repository
git clone https://github.com/mohamedosamaai/bagback-download-showcase.git
cd bagback-download-showcase

# Install dependencies (Installs backend/frontend packages & downloads yt-dlp binary)
npm install
```

### 2. Launch Development Environments
Open two separate terminal instances:

**Terminal 1 (Backend API Server)**:
```bash
cd apps/server
npm run dev
```
*(The backend server operates on `http://localhost:4000`)*

**Terminal 2 (Frontend Web Client)**:
```bash
cd apps/web
npm run dev
```
*(The frontend operates on `http://localhost:5173`)*

---

## 📦 Packages

The core domain interfaces and engine wrappers are distributed as modular packages:

- **`@bagback-download/core`**: Core type definitions and data contracts.
- **`@bagback-download/engine`**: Downloader engine execution abstractions.

---

## 🔒 Security Posture

As a publicly showcased project, Bagback Download places top priority on security:
- 0 vulnerabilities across all dependencies audited via `npm audit`.
- Hardened CodeQL security scanning compliant with OWASP Top 10 standards.
- Fully sanitized parameters for media extractors and path traversal mitigation.

Please see the [SECURITY.md](SECURITY.md) file for more information on our vulnerability disclosure program and secure configuration.

---

## 💎 Sponsorship & Commercial Integration

**Bagback Download Showcase** is open-source and free to use. Maintaining enterprise-grade repositories, ensuring security updates, and providing continuous support requires dedication and resources.

If this project helps your business or organization, please consider supporting development:

- 💖 **[Sponsor via GitHub](https://github.com/sponsors/mohamedosamaai)**: Become a monthly backer to ensure ongoing development.
- ☕ **[Buy Me a Coffee](https://www.buymeacoffee.com/mohamedosama)**: A quick way to show appreciation.
- 💼 **Enterprise & Commercial Support**: Need custom integrations, white-labeling, or dedicated SLA support? Reach out directly via [LinkedIn](https://www.linkedin.com/in/mohamed-osama-ai/) or [Email](mailto:im@mohamedosama.me).

---

## 📄 License

Distributed under the **MIT License**.

*Copyright © 2026 Mohamed Osama & Bagback Digital Solutions*
