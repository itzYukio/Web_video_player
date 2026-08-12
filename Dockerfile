# Build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 may need native compilation on ARM64/other architectures.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# The repository intentionally does not require a committed package-lock.json.
# npm install works with package.json alone and resolves dependencies during the build.
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Runtime stage
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Use npm install rather than npm ci because package-lock.json is not required.
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/tsconfig.json ./tsconfig.json
RUN mkdir -p /data/thumbs /data/subtitles /data/transcoded

EXPOSE 3000
CMD ["npm", "start"]
