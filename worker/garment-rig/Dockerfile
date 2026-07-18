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

# Blender usa un Python embebido y puede ignorar PYTHONPATH cuando ejecuta --python.
# Instalamos el módulo base dentro de la ruta nativa de módulos de Blender para que el
# wrapper pueda importarlo sin depender del cwd, sys.path ni variables del proceso padre.
RUN mkdir -p /opt/blender/4.2/scripts/modules \
    && cp /app/rig_garment_legacy.py /opt/blender/4.2/scripts/modules/rig_garment_legacy.py

ENV PYTHONPATH=/app
ENV CLOUVA_RIG_VERSION=v9

# Smoke test real: importa el módulo base desde la ruta nativa de Blender y ejecuta el
# wrapper completo con un __name__ de prueba, evitando iniciar main(). Si cualquiera de
# los dos archivos no puede cargarse, Railway cancela el build antes del deploy.
RUN test -f /app/rig_garment.py \
    && test -f /app/rig_garment_legacy.py \
    && test -f /opt/blender/4.2/scripts/modules/rig_garment_legacy.py \
    && /opt/blender/blender --background --factory-startup --python-expr "import rig_garment_legacy; namespace={'__name__':'clouva_rig_import_test','__file__':'/app/rig_garment.py'}; exec(compile(open('/app/rig_garment.py', encoding='utf-8').read(), '/app/rig_garment.py', 'exec'), namespace); print('[clouva] Blender wrapper import OK')"

ENV BLENDER_BIN=/usr/local/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
