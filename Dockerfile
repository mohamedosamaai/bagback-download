# ═══════════════════════════════════════════════════
# Stage 1: Build React Frontend
# ═══════════════════════════════════════════════════
FROM node:20-alpine AS frontend-builder

WORKDIR /build

COPY apps/web/package.json ./apps/web/
RUN cd apps/web && npm install

COPY apps/web/ ./apps/web/
RUN cd apps/web && npm run build

# ═══════════════════════════════════════════════════
# Stage 2: Build Node.js Backend & Monorepo Packages
# ═══════════════════════════════════════════════════
FROM node:20-alpine AS backend-builder

WORKDIR /build

COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/
RUN npm install
RUN npx tsc --project packages/core && npx tsc --project packages/downloader-engine && cd apps/server && npm run build

# ═══════════════════════════════════════════════════
# Stage 3: Production Image
# ═══════════════════════════════════════════════════
FROM python:3.12-slim

# Install system dependencies + Deno JS runtime for yt-dlp EJS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    unzip \
    ffmpeg \
    nodejs \
    npm \
    && curl -fsSL https://deno.land/install.sh | sh \
    && cp /root/.deno/bin/deno /usr/local/bin/deno \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp + curl_cffi for browser impersonation
RUN pip install --no-cache-dir --upgrade yt-dlp curl_cffi

# Verify installations
RUN yt-dlp --version && deno --version && ffmpeg -version | head -1

RUN useradd -m -u 1001 bagback

WORKDIR /app

COPY --from=backend-builder /build/apps/server/dist ./dist
COPY --from=backend-builder /build/node_modules ./node_modules
COPY --from=frontend-builder /build/apps/web/dist ./static

RUN mkdir -p /downloads && chown bagback:bagback /downloads
RUN chown -R bagback:bagback /app

USER bagback

ENV NODE_ENV=production
ENV PORT=4000
ENV DOWNLOAD_DIR=/downloads
ENV STATIC_DIR=/app/static

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

CMD ["node", "dist/index.js"]
