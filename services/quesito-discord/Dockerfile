FROM node:22-bookworm-slim AS bgutil-build

ARG BGUTIL_VERSION=2.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/bgutil

RUN curl -L --fail --retry 3 \
    "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/${BGUTIL_VERSION}.tar.gz" \
    -o /tmp/bgutil.tar.gz \
  && tar -xzf /tmp/bgutil.tar.gz --strip-components=1 -C /opt/bgutil \
  && rm /tmp/bgutil.tar.gz

WORKDIR /opt/bgutil/server
RUN npm ci --no-audit --no-fund \
  && npx tsc \
  && npm prune --omit=dev

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl espeak-ng ffmpeg \
  && curl -L --fail --retry 3 \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o /usr/local/bin/yt-dlp \
  && chmod 0755 /usr/local/bin/yt-dlp \
  && yt-dlp --version \
  && rm -rf /var/lib/apt/lists/*

COPY --from=bgutil-build /opt/bgutil/server/build /opt/bgutil/server/build
COPY --from=bgutil-build /opt/bgutil/server/node_modules /opt/bgutil/server/node_modules
COPY --from=bgutil-build /opt/bgutil/plugin/yt_dlp_plugins /usr/local/bin/yt-dlp-plugins/bgutil-ytdlp-pot-provider/yt_dlp_plugins

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.mjs ./
RUN node --check index.mjs

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.mjs"]
