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

# Preserve the current world before the one-time upgrade to Minecraft 26.3.
UPGRADE_MARKER="$WORLD_ROOT/.clouva-minecraft-26.3-upgrade-backed-up"
if [ ! -e "$UPGRADE_MARKER" ]; then
  recovery="$WORLD_ROOT/recovery/pre-26.3-upgrade-20260919"
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
  -p 8100:8100/tcp
  -e EULA=TRUE
  -e TYPE=PAPER
  -e VERSION=26.3
  -e PAPER_CHANNEL=experimental
  -e MEMORY=3G
  -e "MOTD=CLOUVA FAMILIA"
  -e MAX_PLAYERS=12
  -e DIFFICULTY=easy
  -e PVP=false
  -e VIEW_DISTANCE=8
  -e SIMULATION_DISTANCE=6
  -e SPAWN_PROTECTION=16
  -e ONLINE_MODE=FALSE
  -e ENFORCE_SECURE_PROFILE=FALSE
  -e ENABLE_WHITELIST=FALSE
  -e "PLUGINS=https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot,https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot,https://github.com/AuthMe/AuthMeReloaded/releases/download/6.0.1/AuthMe-6.0.1-Paper.jar,https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.27/bluemap-5.27-paper.jar"
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


# BlueMap powers the in-app real-time 3D map.
for _ in $(seq 1 90); do
  bluemap_core="$WORLD_ROOT/plugins/BlueMap/core.conf"
  if [ -f "$bluemap_core" ]; then
    if grep -Eq '^[[:space:]]*accept-download:[[:space:]]*false[[:space:]]*$' "$bluemap_core"; then
      sed -i -E 's/^([[:space:]]*accept-download:)[[:space:]]*false[[:space:]]*$/\1 true/' "$bluemap_core"
      docker restart "$CONTAINER_NAME" >/dev/null
    fi
    break
  fi
  sleep 2
done


# CLOUVA host watchdog: if Docker or the Minecraft listener hangs, recover it locally.
cat >/usr/local/sbin/clouva-minecraft-watchdog.sh <<'EOF'
#!/usr/bin/env bash
set -u

CONTAINER="clouva-minecraft"
FAIL_FILE="/run/clouva-minecraft-watchdog.failures"

failures=0
[ -f "$FAIL_FILE" ] && failures="$(cat "$FAIL_FILE" 2>/dev/null || echo 0)"
case "$failures" in
  ''|*[!0-9]*) failures=0 ;;
esac

systemctl is-active --quiet docker || systemctl restart docker || true

running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)"
if [ "$running" != "true" ]; then
  docker start "$CONTAINER" >/dev/null 2>&1 || true
  sleep 8
fi

if timeout 3 bash -c '</dev/tcp/127.0.0.1/25565' >/dev/null 2>&1; then
  echo 0 >"$FAIL_FILE"
  exit 0
fi

failures=$((failures + 1))
echo "$failures" >"$FAIL_FILE"
logger -t clouva-minecraft-watchdog "Minecraft health check failed ($failures/3)"

if [ "$failures" -ge 3 ]; then
  logger -t clouva-minecraft-watchdog "Restarting Minecraft container after repeated health-check failures"
  docker restart "$CONTAINER" >/dev/null 2>&1 || true
  echo 0 >"$FAIL_FILE"
fi
EOF
chmod 0755 /usr/local/sbin/clouva-minecraft-watchdog.sh

cat >/etc/systemd/system/clouva-minecraft-watchdog.service <<'EOF'
[Unit]
Description=CLOUVA Minecraft local watchdog
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/clouva-minecraft-watchdog.sh
EOF

cat >/etc/systemd/system/clouva-minecraft-watchdog.timer <<'EOF'
[Unit]
Description=Check CLOUVA Minecraft every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now clouva-minecraft-watchdog.timer


# startup metadata sync v2
