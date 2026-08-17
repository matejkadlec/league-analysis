import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORIES = ["app", "components", "features"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

/** Every `<DialogTitle …>` element, from the opening tag to the closing one. */
function dialogTitleElements(): { file: string; element: string }[] {
  return SOURCE_DIRECTORIES.flatMap(sourceFiles)
    .filter((path) => !path.endsWith(join("ui", "dialog.tsx")))
    .flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/<DialogTitle[\s\S]*?<\/DialogTitle>/g)].map(
        (match) => ({ file: relative(process.cwd(), path), element: match[0] }),
      );
    });
}

describe("dialog source contract", () => {
  it("finds the dialogs it is supposed to be checking", () => {
    // Without this the regex above could silently stop matching and the
    // assertion below would pass against an empty list.
    expect(dialogTitleElements().length).toBeGreaterThanOrEqual(5);
  });

  it("titles every dialog with a gold lucide icon", () => {
    const violations = dialogTitleElements()
      .filter(
        ({ element }) =>
          !/<[A-Z][A-Za-z]*\s[^>]*className="[^"]*h-5 w-5[^"]*(?:text-gold-base|text-\[#cfa93a\])/.test(
            element,
          ),
      )
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });
});
