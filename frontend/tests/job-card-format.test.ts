import { describe, expect, it } from "vitest";
import { formatRunInterval } from "@/features/jobs/job-card-format";

describe("formatRunInterval", () => {
  it("formats the resolved interval as English", () => {
    expect(formatRunInterval(1)).toBe("1 second");
    expect(formatRunInterval(30)).toBe("30 seconds");
    expect(formatRunInterval(60)).toBe("1 minute");
    expect(formatRunInterval(900)).toBe("15 minutes");
    expect(formatRunInterval(3600)).toBe("1 hour");
    expect(formatRunInterval(7200)).toBe("2 hours");
    expect(formatRunInterval(9000)).toBe("2 hours, 30 minutes");
  });
});
