from pathlib import Path

import app_v9 as inspector


app = inspector.app
base = inspector
WORKER_INSPECTOR_VERSION = inspector.WORKER_INSPECTOR_VERSION
INSPECT_SCRIPT_PATH = inspector.INSPECT_SCRIPT_PATH
RIG_ROUTE_VERSION = inspector.base.RIG_ROUTE_VERSION
GARMENT_SOURCE_ROUTING_VERSION = inspector.base.GARMENT_SOURCE_ROUTING_VERSION
UNREAL_EXPORT_VERSION = "v31.1-absolute-module-loader"
EXPORT_UNREAL_SCRIPT_PATH = Path(__file__).with_name("export_unreal_v31.py")

# The POST /export/unreal-v2 handler lives in app_v8 and resolves these globals at
# request time. Point it at V31.1 without duplicating or stacking another API route.
inspector.UNREAL_EXPORT_VERSION = UNREAL_EXPORT_VERSION
inspector.base.UNREAL_EXPORT_VERSION = UNREAL_EXPORT_VERSION
inspector.base.EXPORT_UNREAL_SCRIPT_PATH = EXPORT_UNREAL_SCRIPT_PATH
