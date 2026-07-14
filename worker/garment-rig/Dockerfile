FROM linuxserver/blender:4.2.3

USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages fastapi uvicorn pydantic

WORKDIR /app
COPY app.py rig_garment.py ./

ENV BLENDER_BIN=/usr/bin/blender
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
