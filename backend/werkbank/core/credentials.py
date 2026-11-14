"""Anmeldedaten für Entra aus Docker-Secrets."""

import hashlib
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import serialization


def certificate_credential(key_file: Path, cert_file: Path) -> dict[str, str]:
    """Zertifikat und privater Schlüssel in der Form, die MSAL erwartet."""
    cert = x509.load_pem_x509_certificate(cert_file.read_bytes())
    der = cert.public_bytes(serialization.Encoding.DER)
    # Entra erwartet den SHA-1-Fingerabdruck des Zertifikats (Header x5t). Er dient nur als
    # Kennung des Zertifikats, nicht der Sicherheit; signiert wird mit dem privaten Schlüssel.
    thumbprint = hashlib.sha1(der, usedforsecurity=False).hexdigest()  # nosemgrep
    return {"private_key": key_file.read_text(encoding="utf-8"), "thumbprint": thumbprint}
