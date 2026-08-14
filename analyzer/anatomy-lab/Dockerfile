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
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend ./backend
COPY cloud/cloud_app.py ./cloud_app.py
COPY --from=frontend /src/dist ./frontend

RUN pip install --no-cache-dir -r backend/requirements.txt \
    && mkdir -p /app/input /app/output

EXPOSE 8080
CMD ["sh", "-c", "python -m uvicorn cloud_app:app --host 0.0.0.0 --port ${PORT:-8080}"]
