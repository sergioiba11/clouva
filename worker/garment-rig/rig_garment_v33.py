import os


V32_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig_garment_v32.py")


def load_corrected_v43_pipeline():
    if not os.path.exists(V32_PATH):
        raise RuntimeError(f"No se encontró el pipeline V43 en {V32_PATH}")

    with open(V32_PATH, encoding="utf-8") as handle:
        source = handle.read()

    old = "v40 = previous.previous.previous\n"
    new = "v40 = previous.previous.previous.previous\n"
    if old not in source:
        raise RuntimeError("No se encontró el enlace V40 esperado dentro del pipeline V43")

    namespace = {
        "__name__": "clouva_rig_v43_corrected",
        "__file__": V32_PATH,
        "__package__": None,
    }
    exec(compile(source.replace(old, new, 1), V32_PATH, "exec"), namespace)
    return namespace


_corrected = load_corrected_v43_pipeline()
for _name, _value in _corrected.items():
    if _name not in {"__name__", "__file__", "__package__", "__builtins__"}:
        globals()[_name] = _value

LOADER_FIX_VERSION = 431


if __name__ == "__main__":
    main()
