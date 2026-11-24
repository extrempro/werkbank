"""Mails: Branding nur noch von der Plattform

Fußzeile, Datenschutz-Link und Logo aus der Gestaltung der Ticket-Mails wandern ins Branding
der Plattform (nur, wenn dort noch nichts steht); danach entfällt die Tabelle
`ticket_mail_design`. Die eigene Akzentfarbe der Ticket-Mails entfällt: Es gilt die der Plattform.

Revision ID: 0077
Revises: 0076
Erstellt: 2026-11-24
"""

import hashlib
import json
import struct
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0077"
down_revision: str | None = "0076"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _png_size(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(PNG_SIGNATURE) or len(data) < 33 or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return int(width), int(height)


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT footer, privacy_url, logo_png FROM ticket_mail_design WHERE id = 1")
    ).first()
    if row is not None:
        footer = (row[0] or "").strip()[:1000]
        privacy = (row[1] or "").strip()
        if not privacy.startswith("https://") or any(c.isspace() for c in privacy):
            privacy = ""
        stored = conn.execute(
            sa.text("SELECT value FROM app_settings WHERE key = 'branding'")
        ).scalar()
        value = dict(stored) if isinstance(stored, dict) else {}
        changed = False
        if footer and not value.get("mail_footer"):
            value["mail_footer"] = footer
            changed = True
        if privacy and not value.get("privacy_url"):
            value["privacy_url"] = privacy[:500]
            changed = True
        if changed:
            conn.execute(
                sa.text(
                    "INSERT INTO app_settings (key, value) VALUES ('branding', CAST(:v AS JSONB)) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
                ),
                {"v": json.dumps(value)},
            )
        logo = bytes(row[2]) if row[2] is not None else None
        size = _png_size(logo) if logo else None
        exists = conn.execute(
            sa.text("SELECT 1 FROM branding_assets WHERE kind = 'logo-mail'")
        ).first()
        if logo and size and exists is None:
            conn.execute(
                sa.text(
                    "INSERT INTO branding_assets (kind, content_type, data, etag, width, height) "
                    "VALUES ('logo-mail', 'image/png', :data, :etag, :w, :h)"
                ),
                {
                    "data": logo,
                    "etag": hashlib.sha256(logo).hexdigest()[:32],
                    "w": size[0],
                    "h": size[1],
                },
            )
    op.drop_table("ticket_mail_design")


def downgrade() -> None:
    op.create_table(
        "ticket_mail_design",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("accent", sa.String(length=7), server_default="", nullable=False),
        sa.Column("footer", sa.Text(), server_default="", nullable=False),
        sa.Column("privacy_url", sa.String(length=500), server_default="", nullable=False),
        sa.Column("logo_png", sa.LargeBinary(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_mail_design")),
    )
