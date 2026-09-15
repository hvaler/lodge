# Lodge — self-hosted deployment.
#
# Distroless on purpose: this runs inside somebody else's institution, and the smaller the surface
# the shorter the conversation with their security team. No shell, no package manager, no root.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build

WORKDIR /app

# Dependencies first, so a source change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop the dev dependencies: the image ships what runs, not what built it.
RUN npm ci --omit=dev

# ── run ──────────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs24-debian12 AS run

WORKDIR /app

# `nonroot` is a distroless-provided unprivileged user. Nothing here needs more.
USER nonroot

COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
COPY --chown=nonroot:nonroot package.json ./

# The reference institution answers out of the box. Point LODGE_CONFIG at your own file to serve
# your own sources; mount the file and its feeds read-only.
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# No shell in the image, so this is exec form by necessity as well as by preference.
CMD ["dist/server/main.js"]
