#!/bin/sh
set -eu

runtime_dir="${XDG_RUNTIME_DIR:-/tmp/clouva-xdg-runtime}"
mkdir -p "$runtime_dir"
chmod 0700 "$runtime_dir"

export XDG_RUNTIME_DIR="$runtime_dir"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export GALLIUM_DRIVER="${GALLIUM_DRIVER:-llvmpipe}"
export MESA_GL_VERSION_OVERRIDE="${MESA_GL_VERSION_OVERRIDE:-4.5}"
export MESA_GLSL_VERSION_OVERRIDE="${MESA_GLSL_VERSION_OVERRIDE:-450}"

exec xvfb-run \
  --auto-servernum \
  --server-args="-screen 0 1280x1024x24 -nolisten tcp" \
  /opt/blender/blender "$@"
