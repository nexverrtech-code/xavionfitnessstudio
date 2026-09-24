"""Direct UPI: the member pays the gym's own UPI ID from any UPI app and submits the UTR.

No gateway, no fees, no third-party integration. The submission is stored as PENDING and a
staff member verifies the UTR against the gym's bank / UPI statement before any membership
is activated.
"""

from __future__ import annotations

import re
from urllib.parse import quote

_VPA = re.compile(r"^[A-Za-z0-9.\-_]{2,256}@[A-Za-z][A-Za-z0-9.\-]{1,64}$")
_UTR = re.compile(r"^\d{12}$")
_REFERENCE = re.compile(r"^[A-Za-z0-9\-/]{4,64}$")


def is_valid_vpa(vpa: str) -> bool:
    return bool(_VPA.match(vpa or ""))


def normalize_utr(value: str) -> str | None:
    """A UPI UTR / RRN is 12 digits (spaces allowed when typed). Returns None if invalid."""
    digits = re.sub(r"\s+", "", value or "")
    return digits if _UTR.match(digits) else None


def normalize_reference(value: str | None) -> str | None:
    """Bank / card references: 4–64 letters, digits, '-' or '/' (spaces removed, upper-cased)."""
    if not value:
        return None
    text = re.sub(r"\s+", "", value).upper()
    return text if _REFERENCE.match(text) else None


def build_upi_uri(vpa: str, payee_name: str, amount_paise: int, note: str) -> str:
    """Standard UPI deep link understood by every UPI app; the app renders it as a QR."""
    amount = f"{amount_paise / 100:.2f}"
    params = {"pa": vpa, "pn": payee_name[:40], "am": amount, "cu": "INR", "tn": note[:60]}
    return "upi://pay?" + "&".join(f"{k}={quote(str(v), safe='@.-_')}" for k, v in params.items())
