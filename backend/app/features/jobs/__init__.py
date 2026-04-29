"""Jobs feature - Background job management and execution."""

from .router import router as jobs_router
from .service import JobService
from .models import JobConfiguration, JobExecution, JobStatus, JobType, ExecutionType
from .schemas import (
    JobConfigurationResponse,
    JobConfigurationUpdate,
    JobExecutionResponse,
    JobStatusResponse,
    JobTriggerResponse,
)
from .scheduler import (
    start_scheduler,
    shutdown_scheduler,
    get_scheduler,
    sync_job_configuration,
)
from .log_capture import job_log_capture

__all__ = [
    # Router
    "jobs_router",
    # Service
    "JobService",
    # Models
    "JobConfiguration",
    "JobExecution",
    "JobStatus",
    "JobType",
    "ExecutionType",
    # Schemas
    "JobConfigurationResponse",
    "JobConfigurationUpdate",
    "JobExecutionResponse",
    "JobStatusResponse",
    "JobTriggerResponse",
    # Scheduler
    "start_scheduler",
    "shutdown_scheduler",
    "get_scheduler",
    "sync_job_configuration",
    # Utilities
    "job_log_capture",
]
