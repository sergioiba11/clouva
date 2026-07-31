from __future__ import annotations

from pathlib import Path
import unittest

from diagnostic_redaction import redact_diagnostic_text


class AvatarAnalyzerSecurityTests(unittest.TestCase):
    def test_redacts_runtime_secret_and_bearer_value(self):
        secret = "sensitive-token-value"
        text = f"Invalid header value b'Bearer {secret}\\r\\n'"
        redacted = redact_diagnostic_text(text, [f"  {secret}\r\n"])
        self.assertNotIn(secret, redacted)
        self.assertIn("Bearer [REDACTED]", redacted)

    def test_detector_token_is_trimmed_and_invalid_header_is_safe(self):
        source = (Path(__file__).parent / "avatar_analyzer.py").read_text(encoding="utf-8")
        self.assertIn(
            'DETECTOR_SERVICE_TOKEN = (os.environ.get("CLOUVA_MEDIAPIPE_SERVICE_TOKEN") or "").strip()',
            source,
        )
        self.assertIn('except ValueError:', source)
        self.assertIn('"MEDIAPIPE_AUTH_HEADER_INVALID"', source)


if __name__ == "__main__":
    unittest.main()
