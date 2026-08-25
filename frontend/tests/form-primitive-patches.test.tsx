// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../components/ui/form";
import { Input } from "../components/ui/input";

// `components/ui/form.tsx` is a vendored shadcn primitive carrying two
// deliberate patches. Re-adding `form` from the CLI reverts both silently and
// neither revert changes what anyone sees, so these are the tests that notice.

function Harness({ error }: { error?: string }) {
  const form = useForm<{ email: string }>({
    defaultValues: { email: "" },
    resolver: (values) =>
      error
        ? { values: {}, errors: { email: { type: "manual", message: error } } }
        : { values, errors: {} },
  });

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          void form.handleSubmit(() => {})(event);
        }}
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

describe("the patched form primitives", () => {

  it("describes a healthy control by nothing at all", async () => {
    // Upstream points `aria-describedby` at `<id>-form-item-description`
    // unconditionally, and nothing in this app renders that id, so upstream's
    // version names an element that is not in the document.
    render(<Harness />);

    expect(
      screen.getByLabelText("Email").getAttribute("aria-describedby"),
    ).toBe(null);
  });

  it("describes a rejected control by exactly the message on screen", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<Harness error="Invalid email address" />);

    await user.click(screen.getByRole("button", { name: "Submit" }));

    const message = await screen.findByText("Invalid email address");
    const input = screen.getByLabelText("Email");

    // Upstream would list the dangling description id here too.
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("refuses a form primitive used outside a FormField", () => {
    // Upstream guards on `!fieldContext`, which cannot be false, and reads
    // `fieldContext.name` through it one line earlier anyway. Without the patch
    // the label's `htmlFor` is "undefined-form-item", pointing at nothing.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    function Orphan() {
      const form = useForm<{ email: string }>();
      return (
        <Form {...form}>
          <FormItem>
            <FormLabel>Stranded</FormLabel>
          </FormItem>
        </Form>
      );
    }

    expect(() => render(<Orphan />)).toThrow(
      "useFormField should be used within <FormField>",
    );

    consoleError.mockRestore();
  });
});
