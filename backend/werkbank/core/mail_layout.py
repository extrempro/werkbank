"""Einheitliches Aussehen aller Mails der Werkbank (spec.md, „Branding“).

Logo und Name kommen aus dem Branding der Plattform, darunter eine schmale Linie in der
Akzentfarbe, der Text, auf Wunsch ein Kasten mit Angaben und eine Fußzeile mit dem Text und dem
Datenschutz-Link aus dem Branding. HTML mit Tabellenlayout und Inline-CSS, immer zusätzlich eine
Textfassung; das Logo hängt eingebettet an (CID), keine externen Ressourcen, keine Zählpixel.
Alle eingesetzten Werte werden für HTML kodiert.
"""

import html
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import make_msgid
from typing import Any

from sqlalchemy.orm import Session

from werkbank.core.app_settings import get_setting
from werkbank.core.branding import (
    ACCENT_PATTERN,
    BRANDING_KEY,
    DEFAULT_NAME,
    valid_privacy_url,
)
from werkbank.core.models import BrandingAsset

DEFAULT_ACCENT = "#1f57c3"
TEXT = "#171a1f"
MUTED = "#4f5765"
LINE = "#e3e6eb"
SOFT = "#f5f6f8"


@dataclass(frozen=True)
class MailBrand:
    name: str
    accent: str
    # PNG für die Mail (eingebettet); WebP zeigen viele Mailprogramme nicht
    logo_png: bytes | None
    footer: str = ""
    privacy_url: str = ""


def load_mail_brand(db: Session) -> MailBrand:
    """Branding für Mails: Mail-Logo (PNG), sonst das helle Logo, wenn es ein PNG ist."""
    stored: Any = get_setting(db, BRANDING_KEY)
    data = stored if isinstance(stored, dict) else {}
    name = data.get("app_name")
    accent = data.get("accent")
    footer = data.get("mail_footer")
    privacy = data.get("privacy_url")
    logo = db.get(BrandingAsset, "logo-mail") or db.get(BrandingAsset, "logo-hell")
    return MailBrand(
        name=name if isinstance(name, str) and name else DEFAULT_NAME,
        accent=accent
        if isinstance(accent, str) and ACCENT_PATTERN.match(accent)
        else DEFAULT_ACCENT,
        logo_png=logo.data if logo is not None and logo.content_type == "image/png" else None,
        footer=footer.strip() if isinstance(footer, str) else "",
        privacy_url=privacy if isinstance(privacy, str) and valid_privacy_url(privacy) else "",
    )


def on_accent(accent: str) -> str:
    """Schriftfarbe auf der Akzentfarbe: dunkel auf hellen Farben, sonst weiß."""
    try:
        red, green, blue = (int(accent[i : i + 2], 16) for i in (1, 3, 5))
    except ValueError:
        return "#ffffff"
    return TEXT if 0.299 * red + 0.587 * green + 0.114 * blue > 160 else "#ffffff"


def paragraphs(text: str) -> str:
    """Text als HTML-Absätze; Leerzeilen trennen Absätze, Zeilenumbrüche bleiben."""
    blocks = [b.strip() for b in text.replace("\r\n", "\n").split("\n\n") if b.strip()]
    return "".join(
        '<p style="margin:0 0 12px">'
        + "<br>".join(html.escape(line) for line in block.split("\n"))
        + "</p>"
        for block in blocks
    )


def info_box(brand: MailBrand, rows: Sequence[tuple[str, str]], badge: str = "") -> str:
    """Kasten mit Angaben; `badge` steht als farbige Marke in der ersten Zeile."""
    cells = []
    first = True
    if badge:
        cells.append(
            f'<tr><td style="padding:10px 14px;color:{MUTED};width:96px">{html.escape(rows[0][0])}'
            '</td><td style="padding:10px 14px"><span style="display:inline-block;'
            f"padding:2px 10px;border-radius:999px;background:{html.escape(brand.accent)};"
            f'color:{on_accent(brand.accent)};font-weight:700">{html.escape(badge)}</span>'
            "</td></tr>"
        )
        rows = rows[1:]
        first = False
    for label, value in rows:
        border = "" if first else f"border-top:1px solid {LINE};"
        first = False
        cells.append(
            f'<tr><td style="padding:10px 14px;color:{MUTED};width:96px;vertical-align:top;'
            f'{border}">{html.escape(label)}</td><td style="padding:10px 14px;{border}">'
            + "<br>".join(html.escape(line) for line in value.split("\n"))
            + "</td></tr>"
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="margin:14px 0;border-collapse:collapse;font-size:14px;background:{SOFT};'
        f'border-radius:8px">{"".join(cells)}</table>'
    )


def button(brand: MailBrand, url: str, label: str) -> str:
    return (
        f'<p style="margin:20px 0"><a href="{html.escape(url, quote=True)}" '
        f'style="display:inline-block;background:{html.escape(brand.accent)};'
        f"color:{on_accent(brand.accent)};text-decoration:none;padding:10px 18px;"
        f'border-radius:8px;font-weight:600">{html.escape(label)}</a></p>'
    )


def render_html(
    brand: MailBrand,
    *,
    title: str,
    body_html: str,
    footer_lead: str,
    logo_cid: str | None,
    above: str = "",
) -> str:
    """Ganze Mail. `body_html` ist schon kodiert (paragraphs, info_box, button)."""
    accent = html.escape(brand.accent)
    name = html.escape(title or brand.name)
    logo = (
        f'<img src="cid:{html.escape(logo_cid)}" alt="{name}" height="32" '
        'style="display:block;height:32px;width:auto;border:0">'
        if logo_cid
        else ""
    )
    head = (
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        + (f'<td style="padding-right:12px">{logo}</td>' if logo else "")
        + f'<td style="font-size:17px;font-weight:700;color:{TEXT}">{name}</td></tr></table>'
    )
    footer = [f'<p style="margin:0">{html.escape(footer_lead)}</p>'] if footer_lead else []
    if brand.footer:
        footer.append(
            '<p style="margin:4px 0 0">'
            + "<br>".join(html.escape(line) for line in brand.footer.split("\n"))
            + "</p>"
        )
    if brand.privacy_url:
        link = html.escape(brand.privacy_url, quote=True)
        footer.append(
            f'<p style="margin:4px 0 0"><a href="{link}" style="color:{MUTED}">Datenschutz</a></p>'
        )
    above_html = (
        f'<p style="margin:0;padding:8px 12px;font-size:12px;color:{MUTED}">'
        f"{html.escape(above)}</p>"
        if above
        else ""
    )
    return (
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark"></head>'
        f'<body style="margin:0;padding:0;background:{SOFT};'
        f'font-family:Segoe UI,Arial,sans-serif;color:{TEXT}">'
        f"{above_html}"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        '<tr><td align="center" style="padding:12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="max-width:600px;background:#ffffff;border-radius:10px;border:1px solid {LINE}">'
        f'<tr><td style="height:4px;line-height:4px;font-size:0;background:{accent};'
        'border-radius:10px 10px 0 0">&nbsp;</td></tr>'
        f'<tr><td style="padding:16px 24px;border-bottom:1px solid {LINE}">{head}</td></tr>'
        '<tr><td style="padding:24px;font-size:15px;line-height:1.55;color:#171a1f">'
        f"{body_html}</td></tr>"
        + (
            f'<tr><td style="padding:14px 24px 18px;border-top:1px solid {LINE};'
            f'font-size:12px;line-height:1.5;color:{MUTED}">{"".join(footer)}</td></tr>'
            if footer
            else ""
        )
        + "</table></td></tr></table></body></html>"
    )


def footer_text(brand: MailBrand, lead: str) -> list[str]:
    """Fußzeile für die Textfassung."""
    lines = [lead] if lead else []
    if brand.footer:
        lines.append(brand.footer)
    if brand.privacy_url:
        lines.append(f"Datenschutz: {brand.privacy_url}")
    return ["", "--", *lines] if lines else []


def add_html(
    message: EmailMessage,
    brand: MailBrand,
    build: Callable[[str | None], str],
    domain: str,
) -> None:
    """HTML-Fassung anhängen; `build` bekommt die CID des Logos (oder None)."""
    cid = make_msgid(domain=domain) if brand.logo_png else None
    message.add_alternative(build(cid[1:-1] if cid else None), subtype="html")
    if cid and brand.logo_png:
        part = message.get_body(("html",))
        if isinstance(part, EmailMessage):
            part.add_related(brand.logo_png, maintype="image", subtype="png", cid=cid)
