# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# The API writes dispute evidence and generated reports under its working directory.
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/uploads/disputes /app/reports \
    && chown -R app:app /app

# Install production dependencies as the same unprivileged user running the API.
COPY --chown=app:app package*.json ./
USER app
RUN npm ci --omit=dev

COPY --chown=app:app --from=builder /app/dist ./dist

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1
CMD ["node", "dist/main"]
