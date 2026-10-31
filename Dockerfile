# OAuth Field Guide v3: one dependency-free Node process. No build step and no npm install
# at runtime (the server has no runtime dependencies).
#
# Pin the base image by digest for reproducible builds, e.g.
#   docker build --build-arg NODE_IMAGE=node:22-alpine@sha256:<digest> -t oauth-field-guide .
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

LABEL org.opencontainers.image.title="OAuth Field Guide" \
      org.opencontainers.image.description="OAuth setup guides for 103 apps and a live guide generator" \
      org.opencontainers.image.version="3.4.0"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
# Only what the server needs at runtime: no tests, research inputs, dev tools or .env files.
COPY package.json ./
COPY src ./src
COPY public ./public
COPY data/guides ./data/guides
COPY data/library-meta.json ./data/library-meta.json

# Run as the unprivileged "node" user. App files stay root-owned (read-only to the process);
# shared guides live on a volume.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# /api/health answers any Host header, so this probe works with ALLOWED_HOSTS set.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/app.js"]
