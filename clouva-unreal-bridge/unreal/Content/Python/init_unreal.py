import unreal
import clouva_importer

try:
    _clouva_ticker_handle
except NameError:
    _clouva_ticker_handle = unreal.register_slate_post_tick_callback(clouva_importer.tick)
    unreal.log("[CLOUVA] Import bridge activo: Saved/ClouvaInbox")
