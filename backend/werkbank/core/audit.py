"""Schreiben ins Audit-Log."""

import ipaddress
import uuid
from typing import Any

from sqlalchemy.orm import Session

from werkbank.core.models import AuditLog


def truncate_ip(ip: str | None) -> str | None:
    """Kürzt IP-Adressen (Datensparsamkeit): IPv4 auf /24, IPv6 auf /48."""
    if not ip:
        return None
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return None
    prefix = 24 if address.version == 4 else 48
    network = ipaddress.ip_network(f"{address}/{prefix}", strict=False)
    return str(network)


def write_audit(
    session: Session,
    *,
    module: str,
    action: str,
    user_id: uuid.UUID | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
    result: str = "ok",
    ip: str | None = None,
    details: dict[str, Any] | None = None,
    note: str | None = None,
) -> AuditLog:
    """Legt einen Audit-Eintrag an. Der Aufrufer entscheidet über das Commit."""
    entry = AuditLog(
        module=module,
        action=action,
        user_id=user_id,
        object_type=object_type,
        object_id=object_id,
        result=result,
        ip_truncated=truncate_ip(ip),
        details=details,
        note=note,
    )
    session.add(entry)
    return entry
