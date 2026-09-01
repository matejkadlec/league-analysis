// Regression fixture for `house/require-cn-for-classname-composition`: every
// directive suppresses a shape the rule must flag, accepted cases carry none.

declare function cn(...values: unknown[]): string;
declare const isActive: boolean;
declare const tone: string;
declare const extra: string | undefined;
declare const shell: string;

// MUST flag: the interpolated template, which is 47 of this repo's class names.
export const interpolated = () => (
  // oxlint-disable-next-line house/require-cn-for-classname-composition
  <div className={`rounded border p-2 ${tone}`} />
);

// MUST flag: the ternary, which a template-only check walks past.
export const ternary = () => (
  // oxlint-disable-next-line house/require-cn-for-classname-composition
  <div className={isActive ? "bg-muted" : "bg-transparent"} />
);

// MUST flag: the short-circuit spelling of the same conditional.
export const shortCircuit = () => (
  // oxlint-disable-next-line house/require-cn-for-classname-composition
  <span className={isActive && "font-bold"} />
);

// MUST flag: a nullish fallback composes two class strings just as surely.
export const nullish = () => (
  // oxlint-disable-next-line house/require-cn-for-classname-composition
  <span className={extra ?? "text-muted-foreground"} />
);

// MUST flag: plain concatenation.
export const concatenated = () => (
  // oxlint-disable-next-line house/require-cn-for-classname-composition
  <span className={shell + " cursor-pointer"} />
);

// MUST flag: a prop named `*ClassName` is a class name arriving one component
// further down, and merges there under the same rules.
export const passedDown = () => (
  // oxlint-disable-next-line house/require-cn-for-classname-composition
  <Icon iconClassName={`h-4 w-4 ${tone}`} />
);

function Icon(props: { iconClassName: string }) {
  return <i className={props.iconClassName} />;
}

// Accepted -- every one of the above, once it goes through `cn`.
export const merged = () => (
  <div className={cn("rounded border p-2", tone, isActive && "font-bold")} />
);

export const mergedTemplate = () => (
  <div className={cn(`rounded border p-2 ${tone}`)} />
);

// Accepted -- a static string needs no merge.
export const staticString = () => <div className="rounded border p-2" />;

// Accepted -- a template with nothing interpolated is a static string written
// with the wrong quotes.
export const staticTemplate = () => <div className={`rounded border p-2`} />;

// Accepted -- passing a value straight through composes nothing here; wherever
// it was built is where the merge belongs.
export const passThrough = (className: string) => <div className={className} />;

export const memberPassThrough = (props: { className: string }) => (
  <div className={props.className} />
);

// Accepted -- an unrelated attribute.
export const unrelatedAttribute = () => (
  <div title={`player ${tone}`} data-active={isActive ? "yes" : "no"} />
);
