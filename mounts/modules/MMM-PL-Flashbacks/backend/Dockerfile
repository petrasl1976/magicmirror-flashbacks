FROM node:22-bookworm-slim

WORKDIR /app

# deps (cache-friendly)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# app
COPY server.js ./

CMD ["node","server.js"]
