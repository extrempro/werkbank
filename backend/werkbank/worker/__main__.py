"""Start des Workers: python -m werkbank.worker (mit --check nur das Lebenszeichen prüfen)."""

import logging
import signal
import sys
import threading

from werkbank.config import get_settings
from werkbank.worker.runner import heartbeat_is_fresh, run_forever
from werkbank.worker.tasks import REGISTRY


def main(argv: list[str]) -> int:
    if "--check" in argv:
        return 0 if heartbeat_is_fresh() else 1
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    run_forever(settings, stop, REGISTRY)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
