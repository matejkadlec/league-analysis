// Regression fixture for `house/no-long-comments` in JSX position.

// Every `oxlint-disable-next-line` suppresses a comment the rule MUST flag;
// accepted shapes carry no directive, so a false positive fails the run too.

export const MustFlagRun = () => (
  <div>
    {/* oxlint-disable-next-line house/no-long-comments */}
    {/* MUST flag: three consecutive JSX comments are one block — the `{` */}
    {/* hugging each comment is its container, not code the comment trails, */}
    {/* so it must not exempt the run as trailing. */}
    <span>run</span>
  </div>
);

export const AcceptedAtCeiling = () => (
  <div>
    {/* one line of prose */}
    {/* two lines of prose sit exactly at the ceiling */}
    <span>ceiling</span>
  </div>
);

export const AcceptedBareDelimiters = () => (
  <div>
    {/*
      A JSX comment whose opening and closing delimiters sit on their own
      lines is charged for its two prose lines only, so this is at ceiling.
    */}
    <span>delimiters</span>
  </div>
);

export const MustFlagClosingBraceBelow = () => (
  <div>
    {/* oxlint-disable-next-line house/no-long-comments */}
    {/* MUST flag: a container whose closing brace sits on its own line is */}
    {/* still a container, so these three prose lines are one block even
        when the last container parks its brace below. */
    }
    <span>brace-below</span>
  </div>
);

export const AcceptedBraceBelow = () => (
  <div>
    {/* one prose line, brace parked below, still not trailed code */
    }
    <span>accepted-brace-below</span>
  </div>
);
