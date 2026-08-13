FROM node:22-slim AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ENV VITE_ANALYZER_API_PORT=443
RUN npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx libgl1 libglib2.0-0 libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend ./backend
COPY --from=frontend /src/dist /usr/share/nginx/html
COPY cloud/nginx.conf /etc/nginx/nginx.conf
COPY cloud/start.sh /start.sh

RUN pip install --no-cache-dir -r backend/requirements.txt \
    && mkdir -p /app/input /app/output \
    && chmod +x /start.sh

EXPOSE 8080
CMD ["/start.sh"]
