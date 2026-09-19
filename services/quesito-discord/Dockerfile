FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.mjs ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.mjs"]
