// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailCodeInputs } from "@/app/settings/email-code-inputs";
import { emptyCodeDigits } from "@/app/settings/settings-helpers";

/**
 * The component is controlled, so the test owns the digits the way the dialog
 * does. `onClearError` is spied because clearing a stale "wrong code" the
 * moment someone starts retyping is part of what these handlers do.
 */
function Harness({
  onClearError,
  onDigits,
}: {
  onClearError: () => void;
  onDigits: (digits: string[]) => void;
}) {
  const [digits, setDigits] = useState<string[]>(emptyCodeDigits());
  return (
    <EmailCodeInputs
      digits={digits}
      onDigitsChange={(next) => {
        onDigits(next);
        setDigits(next);
      }}
      onClearError={onClearError}
      disabled={false}
    />
  );
}

function renderInputs() {
  const onClearError = vi.fn();
  const onDigits = vi.fn();
  render(<Harness onClearError={onClearError} onDigits={onDigits} />);
  const slots = screen.getAllByRole("textbox") as HTMLInputElement[];
  return { slots, onClearError, onDigits };
}

function values(slots: HTMLInputElement[]): string {
  return slots.map((slot) => slot.value || "_").join("");
}

describe("the six-slot email verification code", () => {
  afterEach(() => {
    cleanup();
  });

  it("takes a code pasted with the words around it", () => {
    // People paste from the mail, and what comes with it is "Your code is
    // 123 456" or a trailing newline. Stripping to digits is the difference
    // between the field filling in and it silently refusing the paste.
    const { slots } = renderInputs();

    fireEvent.paste(slots[0]!, {
      clipboardData: { getData: () => "Your code is 123 456\n" },
    });

    expect(values(slots)).toBe("123456");
  });

  it("replaces a previous code on paste instead of merging into it", () => {
    // Paste the wrong code, then the right one: building on the old digits
    // would leave whatever the shorter new code did not overwrite, and submit
    // a six-digit number that was never in either mail.
    const { slots } = renderInputs();

    fireEvent.paste(slots[0]!, {
      clipboardData: { getData: () => "999999" },
    });
    expect(values(slots)).toBe("999999");

    fireEvent.paste(slots[0]!, {
      clipboardData: { getData: () => "1234" },
    });

    expect(values(slots)).toBe("1234__");
  });

  it("ignores a paste with no digits in it at all", () => {
    const { slots, onClearError } = renderInputs();

    fireEvent.paste(slots[0]!, {
      clipboardData: { getData: () => "no digits here" },
    });

    expect(values(slots)).toBe("______");
    expect(onClearError).not.toHaveBeenCalled();
  });

  it("moves to the next slot as each digit is typed", () => {
    const { slots } = renderInputs();

    fireEvent.change(slots[0]!, { target: { value: "4" } });

    expect(values(slots)).toBe("4_____");
    expect(document.activeElement).toBe(slots[1]);
  });

  it("steps back when backspace lands on an already-empty slot", () => {
    // Without this, deleting a wrong digit leaves the caret on a slot that is
    // already empty and the next backspace does nothing -- the field looks
    // stuck partway through a code.
    const { slots } = renderInputs();

    fireEvent.change(slots[0]!, { target: { value: "1" } });
    fireEvent.keyDown(slots[1]!, { key: "Backspace" });

    expect(document.activeElement).toBe(slots[0]);
  });

  it("will not write past the last slot when digits arrive mid-code", () => {
    // A multi-digit value dropped into slot five has more digits than there
    // are slots left, and without the clip the extras are written to indexes
    // that do not exist -- lengthening the array rather than overflowing
    // anything visible.
    //
    // That is why the length is asserted and not just the boxes: nothing on
    // screen changes, but the dialog above joins this array and refuses any
    // result that is not exactly six characters. A seventh entry leaves all
    // six boxes looking correctly filled under the message "Enter all 6
    // digits", with nothing to click that fixes it.
    const { slots, onDigits } = renderInputs();

    fireEvent.change(slots[4]!, { target: { value: "789" } });

    expect(values(slots)).toBe("____78");
    expect(onDigits).toHaveBeenLastCalledWith(["", "", "", "", "7", "8"]);
  });

  it("keeps letters out of a slot", () => {
    const { slots } = renderInputs();

    fireEvent.change(slots[0]!, { target: { value: "a" } });

    expect(values(slots)).toBe("______");
  });
});
