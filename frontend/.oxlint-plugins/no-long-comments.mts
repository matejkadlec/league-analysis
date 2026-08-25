// A comment past four lines is code that never got clarified, or rationale
// that belongs in docs/ where an owner will find it. A run of consecutive
// `//` lines is ONE block: the repo writes its rationale that way, so
// per-line counting would leave the ceiling unenforceable.

// Flags a five-line `//` run, and a block comment carrying five lines of
// prose — blank ` *` lines included. Accepts anything at the ceiling, two
// short runs split by a blank line or by code, and a `// why` trailing a
// statement, which opens its own block instead of extending the run above.

const DEFAULT_MAX_LINES = 4;

type Position = { line: number; column: number };
type Comment = { type: string; loc: { start: Position; end: Position } };
type Block = { type: string; start: Comment; end: Comment };

type SourceCode = {
  lines: readonly string[];
  getAllComments: () => readonly Comment[];
  getTokenBefore: (
    comment: Comment,
    options: { includeComments: boolean },
  ) => { loc: { end: Position } } | null;
};

type Context = {
  options?: readonly ({ maxLines?: number } | undefined)[];
  sourceCode: SourceCode;
  report: (descriptor: unknown) => void;
};

// `foo(); // why` starts its own block: the code between it and the previous
// line breaks the run, so a one-word aside cannot tip a run over the ceiling.
const isTrailing = (sourceCode: SourceCode, comment: Comment) => {
  const before = sourceCode.getTokenBefore(comment, { includeComments: false });
  return before != null && before.loc.end.line === comment.loc.start.line;
};

// Prose, not span: a bare `/**`, `/*` or `*/` carries no words, while a blank
// ` *` line does, so the same rationale costs the same written as a `//` run
// or as a JSDoc block.
const proseLines = (sourceCode: SourceCode, block: Block) => {
  let count = 0;
  for (
    let line = block.start.loc.start.line;
    line <= block.end.loc.end.line;
    line += 1
  ) {
    const text = sourceCode.lines[line - 1]?.trim() ?? "";
    if (text !== "/**" && text !== "/*" && text !== "*/") count += 1;
  }
  return count;
};

const blocksOf = (sourceCode: SourceCode) => {
  const blocks: Block[] = [];
  let open: Block | null = null;
  for (const comment of sourceCode.getAllComments()) {
    const joins =
      open !== null &&
      open.type === "Line" &&
      comment.type === "Line" &&
      comment.loc.start.line === open.end.loc.end.line + 1 &&
      !isTrailing(sourceCode, comment);
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
        "Keep a comment short enough to carry one non-obvious constraint; longer rationale belongs in docs/.",
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
            message: `This comment carries ${lineCount} lines of prose; the ceiling is ${maxLines}. Keep the constraint a reader needs and cut the narration -- what it replaced, how it was found, which audit walked past it. A run of consecutive line comments counts as one block.`,
          });
        }
      },
    };
  },
};
