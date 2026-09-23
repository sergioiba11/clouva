#!/usr/bin/env python3
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request

METADATA_URL = "http://metadata.google.internal/computeMetadata/v1/instance/attributes/ratcraft-command"
METADATA_HEADERS = {"Metadata-Flavor": "Google"}
CONTAINER = os.environ.get("RATCRAFT_CONTAINER", "clouva-minecraft")
LAST_ID_FILE = os.environ.get("RATCRAFT_LAST_ID_FILE", "/srv/minecraft/.ratcraft-control-last-id")
LAST_RESULT_FILE = os.environ.get("RATCRAFT_LAST_RESULT_FILE", "/srv/minecraft/ratcraft-control-last.json")
POLL_SECONDS = float(os.environ.get("RATCRAFT_CONTROL_POLL_SECONDS", "2"))

NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")
SAFE_TEXT_RE = re.compile(r"[\r\n\x00-\x1f]+")


def log(message):
    print(f"[ratcraft-control] {message}", flush=True)


def read_last_id():
    try:
        with open(LAST_ID_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except FileNotFoundError:
        return ""


def write_last_id(command_id):
    os.makedirs(os.path.dirname(LAST_ID_FILE), exist_ok=True)
    tmp = LAST_ID_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(command_id)
    os.replace(tmp, LAST_ID_FILE)


def write_result(payload):
    os.makedirs(os.path.dirname(LAST_RESULT_FILE), exist_ok=True)
    tmp = LAST_RESULT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    os.replace(tmp, LAST_RESULT_FILE)


def fetch_command():
    request = urllib.request.Request(METADATA_URL, headers=METADATA_HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            raw = response.read().decode("utf-8").strip()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise

    if not raw:
        return None
    data = json.loads(raw)
    if not isinstance(data, dict):
        return None
    return data


def valid_name(value):
    value = str(value or "").strip()
    if not NAME_RE.fullmatch(value):
        raise ValueError("Nombre de jugador inválido")
    return value


def safe_text(value, max_length=120):
    value = SAFE_TEXT_RE.sub(" ", str(value or "")).strip()
    return value[:max_length]


def build_rcon_command(action, args):
    args = args if isinstance(args, dict) else {}

    if action == "whitelist_add":
        return f"whitelist add {valid_name(args.get('player'))}"
    if action == "whitelist_remove":
        return f"whitelist remove {valid_name(args.get('player'))}"
    if action == "whitelist_on":
        return "whitelist on"
    if action == "whitelist_off":
        return "whitelist off"
    if action == "whitelist_list":
        return "whitelist list"

    if action == "op":
        return f"op {valid_name(args.get('player'))}"
    if action == "deop":
        return f"deop {valid_name(args.get('player'))}"

    if action == "kick":
        player = valid_name(args.get("player"))
        reason = safe_text(args.get("reason") or "Removido desde CLOUVA")
        return f"kick {player} {reason}"
    if action == "ban":
        player = valid_name(args.get("player"))
        reason = safe_text(args.get("reason") or "Baneado desde CLOUVA")
        return f"ban {player} {reason}"
    if action == "pardon":
        return f"pardon {valid_name(args.get('player'))}"

    if action == "gamemode":
        player = valid_name(args.get("player"))
        mode = str(args.get("mode") or "").lower()
        if mode not in {"survival", "creative", "adventure", "spectator"}:
            raise ValueError("Modo de juego inválido")
        return f"gamemode {mode} {player}"

    if action == "teleport":
        player = valid_name(args.get("player"))
        target = valid_name(args.get("target"))
        return f"tp {player} {target}"

    if action == "difficulty":
        value = str(args.get("value") or "").lower()
        if value not in {"peaceful", "easy", "normal", "hard"}:
            raise ValueError("Dificultad inválida")
        return f"difficulty {value}"

    if action == "time":
        value = str(args.get("value") or "").lower()
        if value not in {"day", "night", "noon", "midnight"}:
            raise ValueError("Hora inválida")
        return f"time set {value}"

    if action == "weather":
        value = str(args.get("value") or "").lower()
        if value not in {"clear", "rain", "thunder"}:
            raise ValueError("Clima inválido")
        return f"weather {value}"

    if action == "say":
        message = safe_text(args.get("message"), 180)
        if not message:
            raise ValueError("Mensaje vacío")
        return f"say {message}"

    if action == "save_all":
        return "save-all"
    if action == "list":
        return "list"

    raise ValueError("Acción no permitida")


def rcon(command):
    last_error = ""
    for attempt in range(20):
        try:
            check = subprocess.run(
                ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if check.returncode == 0 and check.stdout.strip() == "true":
                result = subprocess.run(
                    ["docker", "exec", CONTAINER, "rcon-cli", command],
                    capture_output=True,
                    text=True,
                    timeout=12,
                )
                if result.returncode == 0:
                    return result.stdout.strip() or "OK"
                last_error = (result.stderr or result.stdout or "rcon failed").strip()
        except Exception as error:
            last_error = str(error)
        time.sleep(2)
    raise RuntimeError(last_error or "Minecraft/RCON no disponible")


def execute(payload):
    command_id = safe_text(payload.get("id"), 80)
    action = safe_text(payload.get("action"), 64)
    if not command_id or not action:
        raise ValueError("Comando incompleto")

    command = build_rcon_command(action, payload.get("args"))
    output = rcon(command)
    return {
        "id": command_id,
        "action": action,
        "ok": True,
        "command": command,
        "output": output,
        "executed_at": int(time.time()),
    }


def main():
    log("agent activo")
    last_id = read_last_id()

    while True:
        try:
            payload = fetch_command()
            if payload:
                command_id = str(payload.get("id") or "").strip()
                if command_id and command_id != last_id:
                    try:
                        result = execute(payload)
                        log(f"{result['action']} -> {result['output']}")
                    except Exception as error:
                        result = {
                            "id": command_id,
                            "action": payload.get("action"),
                            "ok": False,
                            "error": str(error),
                            "executed_at": int(time.time()),
                        }
                        log(f"error {payload.get('action')}: {error}")

                    write_result(result)
                    write_last_id(command_id)
                    last_id = command_id
        except Exception as error:
            log(f"poll error: {error}")

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
