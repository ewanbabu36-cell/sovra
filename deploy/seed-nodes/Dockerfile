# ============================================================
#   SOVRA BOOTSTRAP SEED NODE PRODUCTION CONTAINER
#   Lightweight Alpine Node.js 22 Daemon with Noise_XX & GossipSub
# ============================================================

FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ git
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY scripts/ ./scripts/

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter "./packages/*" run build

# Production Runner Stage
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache curl bash

ENV NODE_ENV=production
ENV SOVRA_P2P_PORT=4001
ENV SOVRA_HTTP_PORT=8080
ENV SOVRA_P2P_HOST=0.0.0.0
ENV SOVRA_DATA_DIR=/app/data

COPY package.json pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/scripts ./scripts

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 4001/tcp
EXPOSE 8080/tcp

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8080/health || exit 1

CMD ["node", "--experimental-strip-types", "scripts/bootstrap-node.ts"]
