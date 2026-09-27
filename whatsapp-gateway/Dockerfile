# Small, no native build step: Baileys is pure JavaScript, and the image-processing peers it
# lists (sharp, jimp) are only for stickers and previews, which this gateway never sends.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --ignore-scripts

COPY src ./src

# Sessions, media and instance metadata live here; mount it as a volume or every restart
# starts with zero clinics connected.
ENV DATA_DIR=/data
ENV PORT=8080
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

USER node
CMD ["node", "src/index.js"]
