# Deadline Day: one container runs the API, the realtime server and the web app.
#   docker compose up --build        (see docker-compose.yml)
#   docker build -t deadline-day . && docker run -p 3001:3001 -e SESSION_SECRET=... -v dd-data:/data deadline-day
#   Render: New > Web Service, pick the repository (see README.md)

# --- Build: install everything and build the web app -------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 downloads a prebuilt binary; these are only needed if it has to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY scripts/package.json scripts/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
COPY scripts scripts
COPY deploy deploy
RUN npm run build

# --- Runtime dependencies only (sources and the web build stay in place) ----------------------------
FROM build AS prod
RUN npm ci --omit=dev && npm cache clean --force

# --- Runtime -----------------------------------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATABASE_URL=file:/data/deadline-day.sqlite
WORKDIR /app
COPY --from=prod /app /app
# The player data the database is seeded from on first start (never regenerated).
COPY data data
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Starts as root only to take ownership of the mounted disk, then runs the server as `node`.
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["node_modules/.bin/tsx", "apps/server/src/main.ts"]
