FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    pydantic \
    mediapipe==0.10.14 \
    numpy==1.26.4 \
    opencv-python-headless

RUN mkdir -p /app/models \
    && wget -q https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task -O /app/models/face_landmarker.task \
    && wget -q https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task -O /app/models/hand_landmarker.task \
    && test -s /app/models/face_landmarker.task \
    && test -s /app/models/hand_landmarker.task

ENV CLOUVA_FACE_LANDMARKER_MODEL=/app/models/face_landmarker.task
ENV CLOUVA_HAND_LANDMARKER_MODEL=/app/models/hand_landmarker.task

COPY landmark_detector_2d.py ./landmark_detector_2d.py
COPY app.py ./app.py

RUN python3 -c "import app; print('[clouva-mediapipe-service] detectors load OK')"

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
