// A comment past two lines is code that never got clarified. Consecutive
// comment lines are ONE block regardless of comment spelling, JSX included.

// A blank ` *` line still counts toward the limit; only a bare `/**`/`*/`
// does not. A run sitting exactly at the ceiling passes; only going over reports.
const DEFAULT_MAX_LINES = 2;

const BARE_DELIMITERS = new Set(["/**", "/*", "*/", "{/*", "{/**", "*/}"]);

type Position = { line: number; column: number };
type Comment = {
  type: string;
  value: string;
  loc: { start: Position; end: Position };
};
type Block = { type: string; start: Comment; end: Comment };

type SourceCode = {
  lines: readonly string[];
  getAllComments: () => readonly Comment[];
  getTokenBefore: (
    comment: Comment,
    options: { includeComments: boolean },
  ) => { value?: string; loc: { end: Position } } | null;
};

type Context = {
  options?: readonly ({ maxLines?: number } | undefined)[];
  sourceCode: SourceCode;
  report: (descriptor: unknown) => void;
};

// `foo(); // why` starts its own block: an aside cannot extend the run above
// it. A `{` hugging the comment is its own JSX container, not trailed code.
const isTrailing = (sourceCode: SourceCode, comment: Comment) => {
  const before = sourceCode.getTokenBefore(comment, { includeComments: false });
  if (before == null || before.loc.end.line !== comment.loc.start.line) {
    return false;
  }
  return !(
    before.value === "{" && before.loc.end.column === comment.loc.start.column
  );
};

// Prose, not span: a bare delimiter line carries no words, so the same
// rationale costs the same in any comment spelling.
const proseLines = (sourceCode: SourceCode, block: Block) => {
  let count = 0;
  for (
    let line = block.start.loc.start.line;
    line <= block.end.loc.end.line;
    line += 1
  ) {
    const text = sourceCode.lines[line - 1]?.trim() ?? "";
    if (!BARE_DELIMITERS.has(text)) count += 1;
  }
  return count;
};

// A disable/enable directive is machinery, not prose: never reported, and a
// run joins ACROSS it, so a mid-essay directive cannot split a block for free.
const isDirective = (comment: Comment) =>
  /^\s*(?:oxlint|eslint)-(?:disable|enable)/.test(comment.value);

const blocksOf = (sourceCode: SourceCode) => {
  const blocks: Block[] = [];
  const directiveLines = new Set<number>();
  let open: Block | null = null;
  for (const comment of sourceCode.getAllComments()) {
    if (isDirective(comment)) {
      if (isTrailing(sourceCode, comment)) {
        // A trailing directive shares its line with code, and code breaks
        // the run; only a standalone directive line is bridged over.
        open = null;
      } else {
        for (
          let line = comment.loc.start.line;
          line <= comment.loc.end.line;
          line += 1
        ) {
          directiveLines.add(line);
        }
      }
      continue;
    }
    let joins = open !== null && !isTrailing(sourceCode, comment);
    if (joins && open !== null) {
      for (
        let line = open.end.loc.end.line + 1;
        line < comment.loc.start.line;
        line += 1
      ) {
        if (!directiveLines.has(line)) {
          joins = false;
          break;
        }
      }
      joins &&= comment.loc.start.line > open.end.loc.end.line;
    }
    if (joins && open !== null) {
      open.end = comment;
      continue;
    }
    open = { type: comment.type, start: comment, end: comment };
    blocks.push(open);
  }
  return blocks;
};

export const noLongCommentsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep a comment short enough to carry one non-obvious constraint, and cut the rest.",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: { maxLines: { type: "integer", minimum: 1 } },
      },
    ],
  },
  createOnce(context: Context) {
    return {
      Program() {
        const maxLines = context.options?.[0]?.maxLines ?? DEFAULT_MAX_LINES;
        for (const block of blocksOf(context.sourceCode)) {
          const lineCount = proseLines(context.sourceCode, block);
          if (lineCount <= maxLines) continue;
          context.report({
            loc: { start: block.start.loc.start, end: block.end.loc.end },
            message: `This comment carries ${lineCount} lines of prose; the ceiling is ${maxLines}. Keep the constraint a reader needs and cut the narration -- what it replaced, how it was found, which audit walked past it. A run of consecutive comment lines counts as one block.`,
          });
        }
      },
    };
  },
};
