"""Job tracking models for monitoring automated job execution."""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any, Final, override

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy import (
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class JobType(str, PyEnum):
    """Enumeration of job types."""

    MATCH_FETCHER = "MATCH_FETCHER"
    PLAYER_UPDATER = "PLAYER_UPDATER"


class JobStatus(str, PyEnum):
    """Enumeration of job execution statuses."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    RATE_LIMITED = "RATE_LIMITED"


class ExecutionType(str, PyEnum):
    """Enumeration of job execution types."""

    REGULAR = "REGULAR"
    TEST = "TEST"


class JobConfiguration(Base):
    """Job configuration model storing job scheduling and settings."""

    __tablename__ = "job_configurations"
    __table_args__: Final = {"schema": "jobs"}

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Unique identifier for job configuration",
    )

    # Job identification
    job_type: Mapped[JobType] = mapped_column(
        ENUM(JobType, name="job_type_enum", create_type=False, schema="jobs"),
        nullable=False,
        index=True,
        comment="Type of job (match_fetcher, player_updater)",
    )

    name: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
        comment="Unique name for this job configuration",
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Description of what the job does",
    )

    # Scheduling configuration
    schedule: Mapped[str] = mapped_column(
        String(256),
        nullable=False,
        comment="Job schedule (cron expression or interval specification)",
    )

    # Status and configuration
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        index=True,
        comment="Whether this job is active and should be scheduled",
    )

    # Dormant: pause state moved to the in-memory runtime-control registry
    # (control.py), where each run carries its own flag. Dropping the column
    # is a schema migration deferred to its own change.
    is_paused: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether a currently running job execution is paused",
    )

    config_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Job-specific configuration parameters in JSON format",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this job configuration was created",
    )

    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When this job configuration was last updated",
    )

    # Relationships
    executions = relationship(
        "JobExecution",
        back_populates="job_config",
        cascade="all, delete-orphan",
        order_by="JobExecution.started_at.desc()",
    )

    @override
    def __repr__(self) -> str:
        """Return string representation of the job configuration."""
        return f"<JobConfiguration(id={self.id}, name='{self.name}', type='{self.job_type.value}', active={self.is_active})>"


class JobExecution(Base):
    """Job execution model storing job run history and metrics."""

    __tablename__ = "job_executions"
    __table_args__: Final = {"schema": "jobs"}

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
        comment="Unique identifier for job execution",
    )

    # Foreign key to job configuration
    job_config_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("jobs.job_configurations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Reference to the job configuration",
    )

    # Execution timing
    started_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
        comment="When this job execution started",
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        index=True,
        comment="When this job execution completed",
    )

    # Execution status
    status: Mapped[JobStatus] = mapped_column(
        ENUM(JobStatus, name="job_status_enum", create_type=False, schema="jobs"),
        nullable=False,
        default=JobStatus.PENDING,
        index=True,
        comment="Current status of job execution",
    )

    # Execution metrics
    api_requests_made: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of API requests made during this execution",
    )

    records_created: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of database records created during this execution",
    )

    records_updated: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Number of database records updated during this execution",
    )

    # Error handling
    error_message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Error message if job execution failed",
    )

    # Detailed execution log
    execution_log: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="Detailed execution log and metrics in JSON format",
    )

    # Detailed logs captured during execution
    detailed_logs: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
        comment="All logs captured during job execution (INFO, WARNING, ERROR, etc.)",
    )

    # Trigger source
    triggered_by: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="system",
        comment="Who triggered the job execution: 'system' (scheduler) or 'user' (manual trigger)",
    )

    # API key error tracking
    has_api_key_error: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether this execution encountered an API key authentication error",
    )

    # Execution type (regular scheduled/manual run vs test run)
    execution_type: Mapped[ExecutionType] = mapped_column(
        ENUM(
            ExecutionType, name="execution_type_enum", create_type=False, schema="jobs"
        ),
        nullable=False,
        default=ExecutionType.REGULAR,
        comment="Type of execution: REGULAR (normal run) or TEST (API health-check run)",
    )

    # Relationships
    job_config = relationship("JobConfiguration", back_populates="executions")

    @override
    def __repr__(self) -> str:
        """Return string representation of the job execution."""
        return f"<JobExecution(id={self.id}, config_id={self.job_config_id}, status='{self.status.value}', started={self.started_at})>"


class PlayerSyncRun(Base):
    """Persist one explicit per-player profile and match synchronization."""

    __tablename__ = "player_sync_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed', "
            "'cancelled', 'rate_limited')",
            name="status_valid",
        ),
        Index(
            "uq_player_sync_runs_active_puuid",
            "puuid",
            unique=True,
            postgresql_where=sa_text("status IN ('pending', 'running')"),
        ),
        Index("ix_player_sync_runs_user_created", "user_id", "created_at"),
        {"schema": "jobs"},
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
    )
    puuid: Mapped[str] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending", server_default="pending"
    )
    match_execution_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("jobs.job_executions.id", ondelete="SET NULL"),
        nullable=True,
    )
    profile_execution_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("jobs.job_executions.id", ondelete="SET NULL"),
        nullable=True,
    )
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


# Create composite indexes for common queries
Index(
    "idx_job_config_type_active",
    JobConfiguration.job_type,
    JobConfiguration.is_active,
)

Index(
    "idx_job_execution_config_started",
    JobExecution.job_config_id,
    JobExecution.started_at.desc(),
)

Index(
    "idx_job_execution_status_started",
    JobExecution.status,
    JobExecution.started_at.desc(),
)
