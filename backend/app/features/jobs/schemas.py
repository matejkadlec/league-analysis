"""Pydantic schemas for Job models."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.schemas import PaginatedResponse

from .intervals import JobIntervalError, resolve_interval_seconds
from .models import ExecutionType, JobStatus, JobType


class JobConfigurationBase(BaseModel):
    """Base job configuration schema with common fields."""

    job_type: JobType = Field(..., description="Type of job")
    name: str = Field(
        ..., min_length=1, max_length=128, description="Unique name for this job"
    )
    description: str | None = Field(
        default=None, description="Description of what the job does"
    )
    schedule: str = Field(
        ...,
        min_length=1,
        max_length=256,
        description="Run interval, spelled '900', 'interval:900' or '900s'",
    )
    is_active: bool = Field(default=True, description="Whether the job is active")
    is_paused: bool = Field(
        default=False,
        description="Whether the currently running execution is paused",
    )
    config_json: dict[str, Any] | None = Field(
        default=None,
        description="Job-specific configuration (for example interval_seconds)",
    )


class JobConfigurationUpdate(BaseModel):
    """Schema for updating an existing job configuration."""

    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None)
    schedule: str | None = Field(default=None, min_length=1, max_length=256)
    is_active: bool | None = None
    config_json: dict[str, Any] | None = None


class JobConfigurationResponse(JobConfigurationBase):
    """Schema for job configuration response data."""

    id: int = Field(..., description="Unique identifier")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    # Computed by the validator below at every construction site, so a
    # response built anywhere ships the real number, never a default.
    interval_seconds: int | None = Field(
        default=None,
        description="The interval the scheduler runs this job on, resolved "
        "from config_json['interval_seconds'] (which wins) or the schedule "
        "string. The card renders this; nothing client-side re-parses "
        "schedule. None means the stored row cannot name its interval -- "
        "nullable rather than raising for the same reason "
        "UserResponse.display_name is looser than UserBase: a hand-edited "
        "legacy row must not 500 the one page an operator would use to see "
        "and fix it. The card falls back to the raw schedule string.",
    )

    is_running: bool = Field(
        default=False,
        description="Whether this job currently has a running execution",
    )
    is_stopping: bool = Field(
        default=False,
        description="Whether this job is in graceful stop mode",
    )
    is_force_stopping: bool = Field(
        default=False,
        description="Whether this job has a force-stop request",
    )
    is_test_running: bool = Field(
        default=False,
        description="Whether a test run is currently active for this job",
    )
    is_test_paused: bool = Field(
        default=False,
        description="Whether the test run is paused",
    )
    is_test_stopping: bool = Field(
        default=False,
        description="Whether the test run is in graceful stop mode",
    )
    is_test_force_stopping: bool = Field(
        default=False,
        description="Whether the test run has a force-stop request",
    )

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def _resolve_interval(self) -> JobConfigurationResponse:
        try:
            self.interval_seconds = resolve_interval_seconds(
                name=self.name, schedule=self.schedule, config_json=self.config_json
            )
        except JobIntervalError:
            self.interval_seconds = None
        return self


class JobExecutionApiCall(BaseModel):
    """One endpoint's grouped calls, as `base.py:StoredAPICall` writes them.

    A single call keeps its whole params dict; a group keeps only the key that
    varied and its first and last value.
    """

    endpoint: str
    region: str
    count: int
    first_timestamp: str | None = None
    last_timestamp: str | None = None
    params: dict[str, str] | None = None
    param_key: str | None = None
    first_param: str | None = None
    last_param: str | None = None


class JobExecutionDetailedLogs(BaseModel):
    """The two keys `base.py:record_execution_completion` writes, each only when non-empty.

    Empty rather than absent, on purpose: a missing key and an empty list mean
    the same thing to the dialog that reads them, and `| None` would put a
    `null` on the wire for every execution that has one of the two but not both.
    """

    logs: list[dict[str, Any]] = Field(default_factory=list[dict[str, Any]])
    api_calls: list[JobExecutionApiCall] = Field(
        default_factory=list[JobExecutionApiCall]
    )


class JobExecutionResponse(BaseModel):
    """Schema for job execution response data."""

    id: int = Field(..., description="Unique identifier")
    job_config_id: int = Field(..., description="Reference to job configuration")
    started_at: datetime = Field(..., description="Execution start time")
    completed_at: datetime | None = Field(
        default=None, description="Execution completion time"
    )
    status: JobStatus = Field(..., description="Execution status")
    api_requests_made: int = Field(default=0, description="Number of API requests made")
    records_created: int = Field(default=0, description="Number of records created")
    records_updated: int = Field(default=0, description="Number of records updated")
    error_message: str | None = Field(
        default=None, description="Error message if failed"
    )
    execution_log: dict[str, Any] | None = Field(
        default=None, description="Detailed execution log"
    )
    detailed_logs: JobExecutionDetailedLogs | None = Field(
        default=None,
        description="All logs captured during execution (includes logs array and summary)",
    )
    triggered_by: str = Field(
        default="system", description="Who triggered the job: 'system' or 'user'"
    )
    has_api_key_error: bool = Field(
        default=False, description="Whether this execution encountered an API key error"
    )
    execution_type: ExecutionType = Field(
        default=ExecutionType.REGULAR,
        description="Type of execution: REGULAR or TEST",
    )

    model_config = ConfigDict(from_attributes=True)


class JobStatusResponse(BaseModel):
    """Schema for overall job system status."""

    scheduler_running: bool = Field(..., description="Whether the scheduler is running")
    active_jobs: int = Field(..., description="Number of active job configurations")
    running_executions: int = Field(
        ..., description="Number of currently running executions"
    )
    last_execution: JobExecutionResponse | None = Field(
        default=None, description="Most recent job execution"
    )
    next_run_time: datetime | None = Field(
        default=None, description="When the next job is scheduled"
    )


class JobTriggerResponse(BaseModel):
    """Schema for manual job trigger response."""

    success: bool = Field(..., description="Whether the job was triggered successfully")
    message: str = Field(..., description="Result message")
    execution_id: int | None = Field(
        default=None, description="ID of created execution record"
    )


class JobControlActionResponse(BaseModel):
    """Schema for pause/resume/stop action responses."""

    success: bool = Field(..., description="Whether the control action succeeded")
    message: str = Field(..., description="Result message")
    is_running: bool = Field(..., description="Whether the job is currently running")
    is_paused: bool = Field(..., description="Whether the job is paused")
    is_stopping: bool = Field(..., description="Whether graceful stop was requested")
    is_force_stopping: bool = Field(..., description="Whether force stop was requested")


class JobExecutionListResponse(PaginatedResponse):
    """Schema for paginated job execution list response."""

    executions: list[JobExecutionResponse]
