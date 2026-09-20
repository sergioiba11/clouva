FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends espeak-ng ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.mjs ./
RUN node --check index.mjs

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.mjs"]
