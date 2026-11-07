# syntax=docker/dockerfile:1.7
# Production image for the API. Build from the repository root (the image also
# needs db/migrations):
#   docker build -f apps/api/Dockerfile -t job-apply-api .

# Pinned by digest: rebuilds are reproducible; bump deliberately for patches.
ARG NODE_IMAGE=node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202

# ---- build: compile TypeScript, then drop dev dependencies ----
FROM ${NODE_IMAGE} AS build
WORKDIR /src/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./
COPY apps/api/src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund
# AWS RDS/Aurora certificate authorities, so the database's TLS certificate is verified.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /src/certs/rds-global-bundle.pem

# ---- runtime: only what's needed to run, as a non-root user ----
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=3000 \
    MIGRATIONS_DIR=/app/db/migrations \
    DB_SSL_CA=/app/certs/rds-global-bundle.pem
WORKDIR /app
COPY --from=build /src/certs/rds-global-bundle.pem /app/certs/rds-global-bundle.pem
# Explicit: the non-root user must be able to read the CA bundle (ADD's
# defaults left it unreadable, which stopped the API connecting to the DB).
RUN chmod 755 /app/certs && chmod 644 /app/certs/rds-global-bundle.pem
COPY --from=build /src/apps/api/package.json ./
COPY --from=build /src/apps/api/node_modules ./node_modules
COPY --from=build /src/apps/api/dist ./dist
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000
# Node handles SIGTERM itself (Nest shutdown hooks drain and close the DB pool).
CMD ["node", "dist/main.js"]
