FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3.10 python3-pip python3-venv git ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
ARG LTX_COMMIT=4b2d053057623ddd4d0a1d3e9cd28890e9ef487f
RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel \
  && git clone https://github.com/Lightricks/LTX-Video.git \
  && cd LTX-Video \
  && git checkout "$LTX_COMMIT" \
  && python3 -m pip install --no-cache-dir ".[inference]"

WORKDIR /app
COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir -r requirements.txt
COPY worker.py ./

ENV LTX_ROOT=/opt/LTX-Video
ENV HF_HOME=/tmp/huggingface
CMD ["python3", "/app/worker.py"]
