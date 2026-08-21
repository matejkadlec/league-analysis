import { describe, expect, it } from "vitest";
import { formatScheduleInterval } from "@/features/jobs/components/job-card-format";

describe("formatScheduleInterval", () => {
  it("formats intervals", () => {
    expect(formatScheduleInterval("1")).toBe("1 second");
    expect(formatScheduleInterval("30")).toBe("30 seconds");
    expect(formatScheduleInterval("60")).toBe("1 minute");
    expect(formatScheduleInterval("900")).toBe("15 minutes");
    expect(formatScheduleInterval("3600")).toBe("1 hour");
    expect(formatScheduleInterval("7200")).toBe("2 hours");
    expect(formatScheduleInterval("9000")).toBe("2 hours, 30 minutes");
  });
  it("reads every interval spelling the scheduler accepts", () => {
    // backend/app/features/jobs/scheduler.py:_parse_interval_from_schedule
    expect(formatScheduleInterval("900s")).toBe("15 minutes");
    expect(formatScheduleInterval("interval:900")).toBe("15 minutes");
    expect(formatScheduleInterval(" 900 ")).toBe("15 minutes");
    // ...including its max(n, 1) clamp, so no schedule ever renders blank.
    expect(formatScheduleInterval("0")).toBe("1 second");
  });
  it("routes cron to cronstrue", () => {
    expect(formatScheduleInterval("0 0 * * *")).toMatch(/00:00/);
    expect(formatScheduleInterval("*/5 * * * *")).toMatch(/5 minutes/);
    expect(formatScheduleInterval("not a schedule")).toBe("not a schedule");
  });
});
