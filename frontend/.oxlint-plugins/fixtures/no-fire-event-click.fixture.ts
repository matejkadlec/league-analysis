// Regression fixture for `house/no-fire-event-click`: an unused directive
// means a detection stopped matching, a report means the rule grew.

type FireEvent = {
  click: (element: unknown) => void;
  dblClick: (element: unknown) => void;
  hover: (element: unknown) => void;
  type: (element: unknown, text: string) => void;
  keyPress: (element: unknown, init: unknown) => void;
  change: (element: unknown, init: unknown) => void;
  paste: (element: unknown, init: unknown) => void;
  error: (element: unknown) => void;
  keyDown: (element: unknown, init: unknown) => void;
  blur: (element: unknown) => void;
};

declare const fireEvent: FireEvent;
declare const user: {
  click: (element: unknown) => Promise<void>;
  type: (element: unknown, text: string) => Promise<void>;
};
declare const button: unknown;
declare const input: unknown;
declare const image: unknown;
declare const it: (name: string, body: () => unknown) => void;

// MUST flag: the click a real user performs, and the one this suite reaches
// for most often.
it("submits the form", () => {
  // oxlint-disable-next-line house/no-fire-event-click
  fireEvent.click(button);
});

// MUST flag: the other pointer actions, which have the same reachability hole.
it("expands on double click", () => {
  // oxlint-disable-next-line house/no-fire-event-click
  fireEvent.dblClick(button);
  // oxlint-disable-next-line house/no-fire-event-click
  fireEvent.hover(button);
});

// MUST flag: typing, where user-event's per-key sequence is the whole point.
it("filters as the player types", () => {
  // oxlint-disable-next-line house/no-fire-event-click
  fireEvent.type(input, "Faker");
  // oxlint-disable-next-line house/no-fire-event-click
  fireEvent.keyPress(input, { key: "Enter" });
});

// Accepted: user-event has no equivalent for these -- `change`/`paste`/`error`
// model events no pointer produces; `keyDown`/`blur` are deliberate singles.
it("recovers from a broken icon", () => {
  fireEvent.change(input, { target: { value: "25" } });
  fireEvent.paste(input, { clipboardData: { getData: () => "Faker#KR1" } });
  fireEvent.error(image);
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.blur(input);
});

// Accepted: the replacement itself.
it("tracks the player", async () => {
  await user.click(button);
  await user.type(input, "Faker");
});
