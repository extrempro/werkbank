"""Vorschau des HTML-Editors (IT-Tools): eine abgeschottete Seite im iframe.

Die Werkbank-Oberfläche darf wegen ihrer Sicherheitsrichtlinie kein Inline-CSS und keine
fremden Bilder zeigen. Diese Seite hat deshalb eine eigene, enge Richtlinie:

- `sandbox allow-scripts` ohne `allow-same-origin`: eigener, undurchsichtiger Ursprung, kein
  Zugriff auf Cookies, Speicher oder die Werkbank; keine Formulare, Pop-ups, Navigation oben.
- Skripte nur das eine Skript dieser Seite (Hash). Es gibt dem Elternfenster einen eigenen
  Nachrichtenkanal (MessagePort) und nimmt das HTML nur darüber entgegen. Es entfernt Skripte,
  Meta-Weiterleitungen, base und eingebettete Rahmen und setzt den Rest ein. Inline-Handler und javascript:-Links verbietet die Richtlinie.
- CSS inline erlaubt, Bilder nur als data:, mit „Abfragen ins Internet“ auch über https.

Der Inhalt geht nie an den Server; die Seite selbst ist für alle Personen gleich.
"""

import base64
import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from werkbank.core.app_settings import tools_internet_enabled
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser

router = APIRouter(prefix="/api/tools")

ToolsUser = Annotated[CurrentUser, Depends(require_roles(Role.TOOLS_USER))]

MESSAGE_TYPE = "werkbank-html-vorschau"
READY_TYPE = "werkbank-html-bereit"
REMOVED = "script,meta[http-equiv],base,iframe,frame,frameset,object,embed,portal"

# Eigener Kanal (MessageChannel): Die Seite gibt dem Elternfenster einen Port; nur darüber kommt
# das HTML. So braucht das Elternfenster kein postMessage an "*".
SCRIPT = (
    "(function(){var c=new MessageChannel();"
    "c.port1.onmessage=function(e){"
    f"if(!e.data||e.data.type!=='{MESSAGE_TYPE}')return;"
    "var d=new DOMParser().parseFromString(String(e.data.html),'text/html');"
    f"d.querySelectorAll('{REMOVED}').forEach(function(n){{n.remove();}});"
    "document.replaceChild(document.importNode(d.documentElement,true),"
    "document.documentElement);};"
    f"window.parent.postMessage({{type:'{READY_TYPE}'}},'*',[c.port2]);}})();"
)
SCRIPT_HASH = base64.b64encode(hashlib.sha256(SCRIPT.encode()).digest()).decode()

PAGE = (
    '<!doctype html><html lang="de"><head><meta charset="utf-8">'
    "<title>Vorschau</title></head><body>"
    f"<script>{SCRIPT}</script></body></html>"
)


def preview_policy(internet: bool) -> str:
    """Sicherheitsrichtlinie der Vorschau; mit Internet auch Bilder über https."""
    images = "img-src data: https:" if internet else "img-src data:"
    return "; ".join(
        [
            "default-src 'none'",
            f"script-src 'sha256-{SCRIPT_HASH}'",
            "style-src 'unsafe-inline'",
            images,
            "font-src data:",
            "form-action 'none'",
            "base-uri 'none'",
            "frame-ancestors 'self'",
            "sandbox allow-scripts",
        ]
    )


@router.get("/html-vorschau", response_class=HTMLResponse)
def html_preview(user: ToolsUser, db: DbDep) -> HTMLResponse:
    """Leere Vorschau-Seite; das HTML kommt aus dem Browser per postMessage."""
    return HTMLResponse(
        PAGE,
        headers={
            "Content-Security-Policy": preview_policy(tools_internet_enabled(db)),
            "Referrer-Policy": "no-referrer",
        },
    )
