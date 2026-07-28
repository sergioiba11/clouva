"""Avatar Analyzer V4.1 renderer with the residual hand-camera patch installed."""
from __future__ import annotations

import multiview_renderer_v4_base as _base
from hand_framing_v41 import install_hand_framing_patch

install_hand_framing_patch(_base)

render_multiview_v4 = _base.render_multiview_v4
cleanup_render_proxies = _base.cleanup_render_proxies

# Retain public camera constants and diagnostic field names used by source contracts.
DEFAULT_HAND_CAMERA_CONFIG = _base.DEFAULT_HAND_CAMERA_CONFIG
HAND_TARGET_COVERAGE = _base.HAND_TARGET_COVERAGE
HAND_MIN_COVERAGE = _base.HAND_MIN_COVERAGE
HAND_MAX_COVERAGE = _base.HAND_MAX_COVERAGE
HAND_RETRY_DIAGNOSTIC_FIELD = "handRetryPerformed"
HAND_DISTAL_VIEW_TEMPLATE = "hand_{suffix}_distal"

__all__ = ["render_multiview_v4", "cleanup_render_proxies"]
