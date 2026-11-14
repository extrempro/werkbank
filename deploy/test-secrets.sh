#!/bin/sh
# Legt Secret-Dateien NUR FÜR TESTS an (CI, lokales Ausprobieren): zufälliges Datenbank-
# Passwort und selbstsignierte Wegwerf-Zertifikate. Nicht für den Betrieb verwenden:
# Dort kommen die Zertifikate aus docs/entra-setup.md.
set -eu
dir="${1:-secrets}"
mkdir -p "$dir"
openssl rand -hex 24 > "$dir/postgres_password"
for name in entra_client collector_client; do
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=werkbank-test" \
    -keyout "$dir/${name}_key.pem" -out "$dir/${name}_cert.pem" 2>/dev/null
done
chmod 444 "$dir"/*
