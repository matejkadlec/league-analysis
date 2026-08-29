"use client";

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMAIL_CODE_LENGTH,
  EMAIL_CODE_SLOTS,
  emptyCodeDigits,
} from "../settings-helpers";

interface EmailCodeInputsProps {
  digits: string[];
  /** Every change retires the error the previous attempt left on screen. */
  onDigitsChange: (digits: string[]) => void;
  disabled: boolean;
}

export function EmailCodeInputs({
  digits,
  onDigitsChange,
  disabled,
}: EmailCodeInputsProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      inputRefs.current[0]?.focus();
    }, 60);

    return () => window.clearTimeout(focusTimer);
  }, []);

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();

    const pastedText = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, EMAIL_CODE_LENGTH);

    if (!pastedText) {
      return;
    }

    const nextCode = emptyCodeDigits();
    pastedText.split("").forEach((digit, index) => {
      nextCode[index] = digit;
    });

    onDigitsChange(nextCode);

    const focusIndex = Math.min(pastedText.length, EMAIL_CODE_LENGTH) - 1;
    inputRefs.current[Math.max(focusIndex, 0)]?.focus();
  };

  const handleChange = (index: number, value: string) => {
    const digitsOnly = value.replace(/\D/g, "");

    if (!digitsOnly) {
      const nextCode = [...digits];
      nextCode[index] = "";
      onDigitsChange(nextCode);
      return;
    }

    if (digitsOnly.length > 1) {
      const nextCode = [...digits];
      digitsOnly
        .slice(0, EMAIL_CODE_LENGTH - index)
        .split("")
        .forEach((digit, offset) => {
          nextCode[index + offset] = digit;
        });
      onDigitsChange(nextCode);

      const nextFocusIndex = Math.min(
        EMAIL_CODE_LENGTH - 1,
        index + digitsOnly.length,
      );
      inputRefs.current[nextFocusIndex]?.focus();
      return;
    }

    const nextCode = [...digits];
    nextCode[index] = digitsOnly;
    onDigitsChange(nextCode);

    if (index < EMAIL_CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Backspace" && digits[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
      return;
    }

    if (event.key === "ArrowRight" && index < EMAIL_CODE_LENGTH - 1) {
      event.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  return (
    <div className="space-y-1.5">
      <Label>Code</Label>
      <div className="flex flex-wrap gap-2">
        {EMAIL_CODE_SLOTS.map((slot, index) => (
          <Input
            key={slot.id}
            inputMode="numeric"
            maxLength={EMAIL_CODE_LENGTH}
            className="h-10 w-10 text-center"
            value={digits[index] ?? ""}
            onChange={(event) => handleChange(index, event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => handleKeyDown(index, event)}
            ref={(element) => {
              inputRefs.current[index] = element;
            }}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
