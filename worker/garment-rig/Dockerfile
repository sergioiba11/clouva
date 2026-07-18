FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    xz-utils \
    libxi6 \
    libxrender1 \
    libxrandr2 \
    libxfixes3 \
    libxcursor1 \
    libxinerama1 \
    libxkbcommon0 \
    libgl1 \
    libegl1 \
    libsm6 \
    && rm -rf /var/lib/apt/lists/*

ENV BLENDER_VERSION=4.2.3
ENV BLENDER_URL=https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz

RUN wget -q "$BLENDER_URL" -O /tmp/blender.tar.xz \
    && mkdir -p /opt/blender \
    && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz \
    && ln -s /opt/blender/blender /usr/local/bin/blender

RUN pip install --no-cache-dir --break-system-packages fastapi uvicorn pydantic python-multipart

WORKDIR /app
COPY app.py app_v5.py rig_garment.py rig_garment_v5.py rig_object.py attach_object.py ./
RUN mv app.py app_legacy.py \
    && mv app_v5.py app.py \
    && mv rig_garment.py rig_garment_legacy.py \
    && mv rig_garment_v5.py rig_garment.py

# Blender usa su propio Python embebido. Sin PYTHONPATH no siempre agrega el directorio
# del script a sys.path, por lo que el wrapper V6 no podía importar rig_garment_legacy.
ENV PYTHONPATH=/app

# Smoke test real con el mismo Python que ejecutará los trabajos. El build debe fallar
# antes del deploy si el wrapper o su módulo legacy dejan de ser importables.
RUN test -f /app/rig_garment.py \
    && test -f /app/rig_garment_legacy.py \
    && /opt/blender/blender --background --python-expr "import sys; sys.path.insert(0, '/app'); import rig_garment_legacy; print('[clouva] Blender module import OK')"

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
