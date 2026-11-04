# ============================================================
#   SOVRA PROTOCOL — PRODUCTION NODE CONTAINER
#   Multi-Stage Hardened Alpine Node.js 22 LTS Runtime
# ============================================================

# STAGE 1: Build & Compilation Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Enable modern package manager
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency manifests and workspace configs
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* tsconfig*.json ./
COPY packages/ ./packages/
COPY nodes/ ./nodes/
COPY services/ ./services/
COPY apps/ ./apps/
COPY scripts/ ./scripts/
COPY public/ ./public/

# Install dependencies and build client bundle
RUN pnpm install --frozen-lockfile || npm install
RUN node --experimental-strip-types scripts/build-client-bundle.ts || true

# STAGE 2: Minimal Hardened Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Install curl for reliable container healthchecks
RUN apk add --no-cache curl

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set production environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV SOVRA_STORAGE_DIR=/app/.sovra-storage-prod
ENV SOVRA_P2P_PORT=4001
ENV SOVRA_HTTP_PORT=3001

# Copy build artifacts and dependencies from builder stage
COPY --from=builder /app /app

# Ensure proper storage directories and permissions for unprivileged node user
RUN mkdir -p /app/.sovra-storage-prod && chown -R node:node /app

# Security: Run as non-privileged 'node' user
USER node

# Expose HTTP REST/SSE port and Noise_XX P2P port
EXPOSE 3001 3443 4001

# Persistent volume mount for SQLite WAL database, keys, and media
VOLUME ["/app/.sovra-storage-prod"]

# Container Healthcheck using native /api/status endpoint
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3001/api/status || exit 1

# Launch the sovereign node
CMD ["node", "--experimental-strip-types", "scripts/dev-server.ts"]
