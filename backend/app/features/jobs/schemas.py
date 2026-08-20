"""Pydantic schemas for Job models."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

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
        ..., min_length=1, max_length=256, description="Job schedule (cron or interval)"
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


class JobConfigurationCreate(JobConfigurationBase):
    """Schema for creating a new job configuration."""

    pass


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
    detailed_logs: dict[str, Any] | None = Field(
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


class JobExecutionListResponse(BaseModel):
    """Schema for paginated job execution list response."""

    executions: list[JobExecutionResponse]
    total: int
    page: int
    size: int
    pages: int

    model_config = ConfigDict(from_attributes=True)
