#!/usr/bin/env bash
set -euo pipefail

DISK_DEVICE="/dev/disk/by-id/google-clouva-minecraft-world"
WORLD_ROOT="/srv/minecraft"
CONTAINER_NAME="clouva-minecraft"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io ca-certificates curl
systemctl enable --now docker

mkdir -p "$WORLD_ROOT"

for _ in $(seq 1 30); do
  [ -e "$DISK_DEVICE" ] && break
  sleep 2
done

if [ ! -e "$DISK_DEVICE" ]; then
  echo "Minecraft data disk not found: $DISK_DEVICE" >&2
  exit 1
fi

if ! blkid "$DISK_DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -F "$DISK_DEVICE"
fi

if ! mountpoint -q "$WORLD_ROOT"; then
  mount "$DISK_DEVICE" "$WORLD_ROOT"
fi

grep -qF "$DISK_DEVICE $WORLD_ROOT ext4" /etc/fstab || echo "$DISK_DEVICE $WORLD_ROOT ext4 defaults,nofail 0 2" >> /etc/fstab

docker pull itzg/minecraft-server:latest

# Preserve the healthy 26.1.2 world before the one-time upgrade to Minecraft 26.2.
UPGRADE_MARKER="$WORLD_ROOT/.clouva-minecraft-26.2-upgrade-backed-up"
if [ ! -e "$UPGRADE_MARKER" ]; then
  recovery="$WORLD_ROOT/recovery/pre-26.2-upgrade-20260919"
  mkdir -p "$recovery"
  for name in world world_nether world_the_end; do
    if [ -e "$WORLD_ROOT/$name" ]; then
      rm -rf "$recovery/$name"
      cp -a "$WORLD_ROOT/$name" "$recovery/$name"
    fi
  done
  touch "$UPGRADE_MARKER"
fi
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker_args=(
  -d
  --name "$CONTAINER_NAME"
  --restart unless-stopped
  -p 25565:25565/tcp
  -p 19132:19132/udp
  -e EULA=TRUE
  -e TYPE=PAPER
  -e VERSION=26.2
  -e MEMORY=3G
  -e "MOTD=CLOUVA FAMILIA"
  -e MAX_PLAYERS=12
  -e DIFFICULTY=easy
  -e PVP=false
  -e VIEW_DISTANCE=8
  -e SIMULATION_DISTANCE=6
  -e SPAWN_PROTECTION=16
  -e ONLINE_MODE=TRUE
  -e ENABLE_WHITELIST=FALSE
  -e "PLUGINS=https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot,https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot"
  -v "$WORLD_ROOT:/data"
)

docker run "${docker_args[@]}" itzg/minecraft-server:latest

# Floodgate lets Bedrock/Xbox Live accounts join without a Java account.
# Geyser creates this config on the first Paper boot, so switch auth once it exists.
for _ in $(seq 1 90); do
  config="$(find "$WORLD_ROOT/plugins" -maxdepth 3 -type f -name config.yml -ipath '*geyser*' 2>/dev/null | head -n 1 || true)"
  if [ -n "$config" ]; then
    if grep -Eq '^[[:space:]]*auth-type:[[:space:]]*online[[:space:]]*$' "$config"; then
      sed -i -E 's/^([[:space:]]*auth-type:)[[:space:]]*online[[:space:]]*$/\1 floodgate/' "$config"
      docker restart "$CONTAINER_NAME"
    fi
    break
  fi
  sleep 2
done
