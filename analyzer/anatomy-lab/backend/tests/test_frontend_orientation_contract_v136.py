from pathlib import Path

text = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "main.jsx").read_text(encoding="utf-8")

def test_frontend_only_persists_z_front_back_flip():
    assert "X -90°" not in text
    assert "Y -90°" not in text
    assert "Z -90°" not in text
    assert "Frente invertido 180°" in text
    assert "z: Number(current.z || 0) % 4 === 2 ? 0 : 2" in text
    assert "reviewDepth >= reviewHeight" in text

def test_frontend_blocks_stale_backend_contract():
    assert 'const APP_VERSION = "v1.3.6"' in text
    assert 'const REQUIRED_GARMENT_ANALYSIS_VERSION = "clouva-garment-upright-contract-v1.3.6"' in text
    assert 'payload.version !== REQUIRED_GARMENT_ANALYSIS_VERSION' in text
    assert 'Backend desactualizado' in text
