import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from werkbank.core.audit import truncate_ip, write_audit


@pytest.mark.parametrize(
    ("ip", "expected"),
    [
        ("192.0.2.123", "192.0.2.0/24"),
        ("2001:db8:1234:5678::1", "2001:db8:1234::/48"),
        ("kein-ip", None),
        (None, None),
        ("", None),
    ],
)
def test_truncate_ip(ip: str | None, expected: str | None) -> None:
    assert truncate_ip(ip) == expected


@pytest.mark.db
def test_audit_entry_is_written(db_session: Session) -> None:
    entry = write_audit(
        db_session, module="kern", action="test.schreiben", ip="198.51.100.7", details={"a": 1}
    )
    db_session.commit()
    assert entry.id is not None
    assert entry.ip_truncated == "198.51.100.0/24"
    assert entry.occurred_at is not None


@pytest.mark.db
def test_audit_update_is_rejected(db_session: Session) -> None:
    entry = write_audit(db_session, module="kern", action="test.aendern")
    db_session.commit()
    with pytest.raises(DBAPIError, match="nur anhängend"):
        db_session.execute(
            text("UPDATE audit_log SET action = 'manipuliert' WHERE id = :id"), {"id": entry.id}
        )
    db_session.rollback()


@pytest.mark.db
def test_audit_delete_is_rejected(db_session: Session) -> None:
    entry = write_audit(db_session, module="kern", action="test.loeschen")
    db_session.commit()
    with pytest.raises(DBAPIError, match="nur anhängend"):
        db_session.execute(text("DELETE FROM audit_log WHERE id = :id"), {"id": entry.id})
    db_session.rollback()


@pytest.mark.db
def test_audit_truncate_is_rejected(db_session: Session) -> None:
    with pytest.raises(DBAPIError, match="nur anhängend"):
        db_session.execute(text("TRUNCATE audit_log"))
    db_session.rollback()
