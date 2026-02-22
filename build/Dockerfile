# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    MM_DIR=/opt/magic_mirror \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git ca-certificates dumb-init \
    python3 make g++ \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR ${MM_DIR}

RUN git clone --depth 1 https://github.com/MagicMirrorOrg/MagicMirror.git . \
 && npm ci --omit=dev --no-audit --no-fund

# Skip recursive chown to speed up build on NAS
# Keep running as root since we only read config via bind mounts

EXPOSE 8080
ENTRYPOINT ["/usr/bin/dumb-init","--"]
CMD ["node","serveronly"]

