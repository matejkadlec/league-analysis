"""Jobs feature - Background job management and execution."""

from .log_capture import job_log_capture
from .models import ExecutionType, JobConfiguration, JobExecution, JobStatus, JobType
from .router import router as jobs_router
from .scheduler import (
    StartupRecoveryError,
    get_scheduler,
    shutdown_scheduler,
    start_scheduler,
    sync_job_configuration,
)
from .schemas import (
    JobConfigurationResponse,
    JobConfigurationUpdate,
    JobExecutionResponse,
    JobStatusResponse,
    JobTriggerResponse,
)
from .service import JobService

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
    "StartupRecoveryError",
    "get_scheduler",
    "sync_job_configuration",
    # Utilities
    "job_log_capture",
]
