"""Schnittstelle der IT-Tools für Abfragen ins Internet (nur mit Rolle Tools.User).

Die Oberfläche rechnet weiter im Browser; der Server holt nur, was der Browser wegen der
Sicherheitsrichtlinie nicht selbst abrufen darf. Ziele stehen fest oder kommen aus dem
RDAP-Verzeichnis der IANA.
"""

import base64
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field

from werkbank.core.app_settings import tools_internet_enabled
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.modules.tools.net import (
    RESOLVERS,
    TYPE_CODES,
    Fetcher,
    NetError,
    crtsh_names,
    dns_query,
    http_fetch,
    pwned_range,
    rdap_lookup,
)

router = APIRouter(prefix="/api/tools/net")

ToolsUser = Annotated[CurrentUser, Depends(require_roles(Role.TOOLS_USER))]

DNS_BATCH_MAX = 20
DNS_PARALLEL = 8


def get_fetcher() -> Fetcher:
    """In Tests ersetzbar."""
    return http_fetch


FetcherDep = Annotated[Fetcher, Depends(get_fetcher)]

OFF_TEXT = "Abfragen ins Internet sind für die IT-Tools in der Verwaltung ausgeschaltet."


def _enabled(db: DbDep) -> None:
    if not tools_internet_enabled(db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=OFF_TEXT)


Enabled = Depends(_enabled)


def _failed(error: NetError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error))


class ResolverOut(BaseModel):
    id: str
    name: str


class StatusOut(BaseModel):
    enabled: bool
    resolvers: list[ResolverOut]
    types: list[str]


@router.get("/status")
def net_status(user: ToolsUser, db: DbDep) -> StatusOut:
    """Ob Abfragen erlaubt sind und welche Resolver und Typen es gibt."""
    return StatusOut(
        enabled=tools_internet_enabled(db),
        resolvers=[ResolverOut(id=key, name=value[0]) for key, value in RESOLVERS.items()],
        types=list(TYPE_CODES),
    )


class DnsQueryIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=10)


class DnsIn(BaseModel):
    resolver: str = Field(max_length=20)
    queries: list[DnsQueryIn] = Field(min_length=1, max_length=DNS_BATCH_MAX)


class DnsAnswerOut(BaseModel):
    name: str
    type: str
    # Antwort im Wire-Format (RFC 1035) als Base64; None bei einem Fehler
    wire: str | None
    ms: int | None
    error: str | None


@router.post("/dns", dependencies=[Enabled])
def dns(body: DnsIn, user: ToolsUser, fetch: FetcherDep) -> list[DnsAnswerOut]:
    """Bis zu 20 DNS-Abfragen an einen der festen Resolver (DNS über HTTPS)."""
    if body.resolver not in RESOLVERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unbekannter Resolver."
        )

    def one(query: DnsQueryIn) -> DnsAnswerOut:
        qtype = query.type.upper()
        try:
            wire, ms = dns_query(fetch, body.resolver, query.name, qtype)
        except NetError as error:
            return DnsAnswerOut(name=query.name, type=qtype, wire=None, ms=None, error=str(error))
        return DnsAnswerOut(
            name=query.name,
            type=qtype,
            wire=base64.b64encode(wire).decode("ascii"),
            ms=ms,
            error=None,
        )

    with ThreadPoolExecutor(max_workers=min(DNS_PARALLEL, len(body.queries))) as pool:
        return list(pool.map(one, body.queries))


class RdapOut(BaseModel):
    url: str
    data: Any


@router.get("/rdap", dependencies=[Enabled])
def rdap(
    user: ToolsUser,
    fetch: FetcherDep,
    kind: Annotated[str, Query(pattern="^(domain|ip|autnum)$")],
    value: Annotated[str, Query(min_length=1, max_length=255)],
) -> RdapOut:
    """RDAP bei der zuständigen Registry (Domain, IP-Adresse oder Netz, AS-Nummer)."""
    try:
        url, data = rdap_lookup(fetch, kind, value)
    except NetError as error:
        raise _failed(error) from error
    return RdapOut(url=url, data=data)


class PwnedOut(BaseModel):
    # Zeilen „Hash-Ende:Anzahl“; die Prüfung macht der Browser
    body: str


@router.get("/pwned/{prefix}", dependencies=[Enabled])
def pwned(
    user: ToolsUser,
    fetch: FetcherDep,
    prefix: Annotated[str, Path(pattern="^[0-9A-Fa-f]{5}$")],
) -> PwnedOut:
    """Have I Been Pwned mit k-Anonymität: nur die ersten fünf Zeichen des SHA-1-Hashs."""
    try:
        return PwnedOut(body=pwned_range(fetch, prefix))
    except NetError as error:
        raise _failed(error) from error


@router.get("/crtsh", dependencies=[Enabled])
def crtsh(
    user: ToolsUser,
    fetch: FetcherDep,
    domain: Annotated[str, Query(min_length=1, max_length=253)],
) -> list[dict[str, str]]:
    """Namen aus Zertifikats-Transparenzlogs (crt.sh) zu einer Domain."""
    try:
        return crtsh_names(fetch, domain)
    except NetError as error:
        raise _failed(error) from error
