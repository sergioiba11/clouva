FROM python:3.11-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    REPO_URL=https://github.com/sergioiba11/clouva.git \
    BRANCH=workspace-official-v1 \
    LAB_PATH=analyzer/anatomy-lab

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git nginx libgl1 libglib2.0-0 libgomp1 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --disable-pip-version-check --upgrade pip \
    && mkdir -p /opt/mediapipe-models \
    && curl --fail --location --retry 5 --retry-all-errors \
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task" \
      --output /opt/mediapipe-models/pose_landmarker.task \
    && curl --fail --location --retry 5 --retry-all-errors \
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" \
      --output /opt/mediapipe-models/face_landmarker.task \
    && curl --fail --location --retry 5 --retry-all-errors \
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" \
      --output /opt/mediapipe-models/hand_landmarker.task

COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /usr/local/bin/clouva-analyzer-dev
RUN chmod +x /usr/local/bin/clouva-analyzer-dev

EXPOSE 8080
CMD ["/usr/local/bin/clouva-analyzer-dev"]
