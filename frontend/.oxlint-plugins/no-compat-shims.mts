// This is an application, not a library: every caller lives in this repo, so a
// rename updates its call sites and the superseded path is deleted.

// Two checks, one rule: compat markers in comments, and a declaration naming
// itself superseded. The same words as data are fine -- literals aren't scanned.

type CommentContext = {
  sourceCode: {
    getAllComments: () => readonly { value: string; loc: unknown }[];
  };
  report: (descriptor: unknown) => void;
};

type MaybeIdentifier = { type: string; name?: string } | null | undefined;

const COMPAT_COMMENT =
  /@deprecated|backwards?[- ]compat|kept for (old|compat|legacy)|for old (callers|clients|formats?)|supports? the old\b|\blegacy (path|format|behavio|support)|old format\b/i;
const COMPAT_NAME = /^(legacy|deprecated)|(Legacy|Deprecated)/;

export const noCompatShimsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban backward-compatibility shims: @deprecated and kept-for-compat comments, and legacy/deprecated identifiers.",
    },
    schema: [],
  },
  createOnce(context: CommentContext) {
    const checkName = (id: MaybeIdentifier) => {
      if (id?.type === "Identifier" && id.name && COMPAT_NAME.test(id.name)) {
        context.report({
          node: id,
          message: `Identifier "${id.name}" declares a superseded thing. Don't keep two ways to do the same thing -- replace the old one and update its callers in this change; the type-checker finds them.`,
        });
      }
    };
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = COMPAT_COMMENT.exec(comment.value);
          if (match) {
            context.report({
              loc: comment.loc,
              message: `Backward-compatibility marker in a comment ("${match[0]}"). Nothing outside this repo calls our internals: update every caller in this change, migrate data forward, and delete the old path -- git is the archive.`,
            });
          }
        }
      },
      VariableDeclarator(node: { id: MaybeIdentifier }) {
        checkName(node.id);
      },
      FunctionDeclaration(node: { id: MaybeIdentifier }) {
        checkName(node.id);
      },
      ClassDeclaration(node: { id: MaybeIdentifier }) {
        checkName(node.id);
      },
      TSTypeAliasDeclaration(node: { id: MaybeIdentifier }) {
        checkName(node.id);
      },
      TSInterfaceDeclaration(node: { id: MaybeIdentifier }) {
        checkName(node.id);
      },
    };
  },
};
