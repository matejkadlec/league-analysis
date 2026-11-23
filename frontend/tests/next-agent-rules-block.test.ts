import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeAgentFiles } from "next/dist/server/lib/generate-agent-files";
import { afterEach, describe, expect, it } from "vitest";

const committedAgentsMd = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "AGENTS.md",
);

/**
 * `next dev` rewrites this block whenever it differs from what the installed
 * Next.js generates, dirtying the tree. After a bump, copy the new block in.
 */
describe("Next.js agent-rules block in frontend/AGENTS.md", () => {
  let workspace = "";

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    workspace = "";
  });

  function copyOfAgentsMd(contents?: string): string {
    workspace = mkdtempSync(join(tmpdir(), "lga-agent-rules-"));
    const target = join(workspace, "AGENTS.md");
    if (contents === undefined) copyFileSync(committedAgentsMd, target);
    else writeFileSync(target, contents, "utf-8");
    return target;
  }

  it("is byte-for-byte what next dev writes, so starting the app changes nothing", () => {
    const target = copyOfAgentsMd();

    const result = writeAgentFiles(workspace);

    expect(readFileSync(target, "utf-8")).toBe(
      readFileSync(committedAgentsMd, "utf-8"),
    );
    expect(result.agentsMd).toBe("unchanged");
  });

  it("is rewritten by next dev once it drifts from the installed Next.js", () => {
    const committed = readFileSync(committedAgentsMd, "utf-8");
    const drifted = committed.replace(
      "## This is NOT the Next.js you know",
      "# This is NOT the Next.js you know",
    );
    expect(drifted).not.toBe(committed);
    const target = copyOfAgentsMd(drifted);

    const result = writeAgentFiles(workspace);

    expect(result.agentsMd).toBe("updated");
    expect(readFileSync(target, "utf-8")).toBe(committed);
  });
});
