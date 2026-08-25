// Unbuilt work leaves no trace in the code: it is built in this change, or it
// becomes an LGA ticket and the marker goes. A deferral recorded only in a
// comment is a scope decision made where no owner will read it.

// Accepted: the same letters in another sense. Word boundaries keep longer
// words out, the deferring-verb anchor keeps a bare "later" out, and only
// comments are read -- a marker held in a string literal is data.

type CommentContext = {
  sourceCode: {
    getAllComments: () => readonly { value: string; loc: unknown }[];
  };
  report: (descriptor: unknown) => void;
};

const DEFERRAL =
  /\b(TODO|FIXME|XXX)\b|\bhack(y|ish)?\b|for now\b|\btemporar(y|ily)\b|\bstopgap\b|\bband-aid\b|quick (fix|follow)|good enough for\b|for the demo\b|in a real (app|product|implementation)\b|(implement|handle|clean(ed)? up|improve|finish|fix( it)?|do (this|it)|revisit)\s+(this\s+)?later\b|\bfollow-?up (PR|task|change)\b/i;

export const noDeferralCommentsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban deferral markers in comments: unbuilt work is built now or filed as an LGA ticket, never recorded as a comment.",
    },
    schema: [],
  },
  createOnce(context: CommentContext) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = DEFERRAL.exec(comment.value);
          if (match) {
            context.report({
              loc: comment.loc,
              message: `Deferral marker in a comment ("${match[0]}"). Build it now, or file an LGA ticket for the unbuilt work and delete this marker -- a deferral that lives only in a comment defaults to permanent.`,
            });
          }
        }
      },
    };
  },
};
