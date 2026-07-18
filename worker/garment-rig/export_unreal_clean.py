import sys
from pathlib import Path

# Blender executes --python files from a temporary working directory and does not
# always add /app (the Worker scripts directory) to sys.path.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import export_unreal as base

# The scale cleanup now lives in the single base exporter. Keeping this file as the
# deployed entrypoint preserves the existing /export/unreal-v2 architecture without
# overriding or applying the normalization a second time.

if __name__ == "__main__":
    base.main()
