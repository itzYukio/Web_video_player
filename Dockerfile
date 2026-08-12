# VPS Video Library 3.0.2 — Coolify/Docker build

FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 may need native compilation on ARM64/other architectures.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# No package-lock.json is required by this repository.
RUN npm install --no-audit --no-fund

COPY . .
# The React frontend is intentionally stored under client/src/.
RUN test -f client/src/main.tsx
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Keep tsx available because the server entrypoint is TypeScript.
RUN npm install --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /data/thumbs /data/subtitles /data/transcoded

EXPOSE 3000
CMD ["npm", "start"]
