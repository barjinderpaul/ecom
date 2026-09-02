# syntax=docker/dockerfile:1
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first so the layer is cached across source edits.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY data ./data

# Run as the unprivileged user that ships with the official image.
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
