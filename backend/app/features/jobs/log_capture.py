"""Global log capture instance for job logging.

This module provides the global LogCapture instance used by all jobs.
It's in a separate module to avoid circular import issues.
"""

from collections import deque
from collections.abc import MutableMapping
from typing import Any


class BoundedLogCapture:
    """Log capture with bounded memory using deque.

    Automatically drops oldest entries when max capacity is reached. Only
    events emitted while a job execution is bound (they carry the
    ``job_execution_id`` contextvar, merged before this processor runs) are
    captured: the deque exists so ``_get_job_logs`` can persist a job's own
    records at completion, and request-scoped traffic would otherwise evict
    a long job's early entries before they are harvested.
    """

    def __init__(self, maxlen: int = 1000):
        """Initialize with bounded deque that auto-drops oldest entries."""
        self.entries: deque[MutableMapping[str, Any]] = deque(maxlen=maxlen)

    def __call__(
        self, _: object, _method_name: str, event_dict: MutableMapping[str, Any]
    ) -> MutableMapping[str, Any]:
        """Capture job-tagged entries (structlog processor interface)."""
        if "job_execution_id" in event_dict:
            self.entries.append(event_dict)
        return event_dict


# Global log capture instance with bounded memory (max 1000 entries)
job_log_capture = BoundedLogCapture(maxlen=1000)
