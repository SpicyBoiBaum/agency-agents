# Container für den Betrieb im Internet (Railway, Render, Fly.io, eigener Server).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TRUST_PROXY=1 \
    DATA_DIR=/data

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public

# Läuft als root: Hosting-Volumes (z. B. bei Railway) werden root-eigen
# eingehängt, ein unprivilegierter Benutzer könnte dort nicht schreiben.
RUN mkdir -p /data

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "server.js"]
