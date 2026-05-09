"use client";

import {
  type ClipboardEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type Props = {
  length: number;
  name?: string;
  autoFocus?: boolean;
  hasError?: boolean;
  onComplete?: () => void;
};

export function OtpInput({
  length,
  name = "code",
  autoFocus = true,
  hasError = false,
  onComplete,
}: Props) {
  const [digits, setDigits] = useState<string[]>(() =>
    Array.from({ length }, () => ""),
  );
  const digitsRef = useRef<string[]>(Array.from({ length }, () => ""));
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const tokenInput = useRef<HTMLInputElement | null>(null);
  const groupId = useId();

  useEffect(() => {
    if (autoFocus) inputs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const input = tokenInput.current;
    const form = input?.form;
    if (!input || !form) return;

    const syncBeforeSubmit = () => syncHiddenInput();
    const syncFormData = (event: FormDataEvent) => {
      event.formData.set(name, syncHiddenInput());
    };

    form.addEventListener("submit", syncBeforeSubmit);
    form.addEventListener("formdata", syncFormData);
    return () => {
      form.removeEventListener("submit", syncBeforeSubmit);
      form.removeEventListener("formdata", syncFormData);
    };
  }, [name]);

  const syncHiddenInput = () => {
    const visibleValue = inputs.current
      .slice(0, length)
      .map((el) => el?.value.replace(/\D/g, "").slice(0, 1) ?? "")
      .join("");
    const value = visibleValue || digitsRef.current.join("");
    if (tokenInput.current) tokenInput.current.value = value;
    return value;
  };

  const commitDigits = (next: string[]) => {
    digitsRef.current = next;
    if (tokenInput.current) tokenInput.current.value = next.join("");
    setDigits(next);
    if (next.every((d) => d.length === 1)) onComplete?.();
  };

  const handleTokenInput = (raw: string) => {
    const value = raw.replace(/\D/g, "").slice(0, length);
    const next = Array.from({ length }, (_, index) => value[index] ?? "");
    commitDigits(next);
    requestAnimationFrame(() => {
      const focusTarget = Math.min(value.length, length - 1);
      focusAt(focusTarget);
    });
  };

  const focusAt = (index: number) => {
    const el = inputs.current[index];
    if (!el) return;
    el.focus();
    requestAnimationFrame(() => {
      el.select();
    });
  };

  const setAt = (index: number, value: string) => {
    const next = [...digitsRef.current];
    next[index] = value;
    commitDigits(next);
  };

  const handleChange = (index: number, value: string) => {
    const onlyDigits = value.replace(/\D/g, "");
    if (onlyDigits.length === 0) {
      setAt(index, "");
      return;
    }
    if (onlyDigits.length === 1) {
      setAt(index, onlyDigits);
      if (index < length - 1) focusAt(index + 1);
      return;
    }
    fillFrom(index, onlyDigits);
  };

  const fillFrom = (start: number, raw: string) => {
    const onlyDigits = raw.replace(/\D/g, "").slice(0, length - start);
    if (!onlyDigits) return;
    const next = [...digitsRef.current];
    for (let i = 0; i < onlyDigits.length; i++) {
      next[start + i] = onlyDigits[i]!;
    }
    commitDigits(next);
    const lastFilled = Math.min(start + onlyDigits.length - 1, length - 1);
    const focusTarget =
      lastFilled === length - 1 ? lastFilled : lastFilled + 1;
    requestAnimationFrame(() => focusAt(focusTarget));
  };

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Backspace") {
      if (digits[index]) {
        setAt(index, "");
        return;
      }
      if (index > 0) {
        event.preventDefault();
        setAt(index - 1, "");
        focusAt(index - 1);
      }
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusAt(index - 1);
      return;
    }
    if (event.key === "ArrowRight" && index < length - 1) {
      event.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (
    index: number,
    event: ClipboardEvent<HTMLInputElement>,
  ) => {
    const text = event.clipboardData.getData("text");
    if (!/\d/.test(text)) return;
    event.preventDefault();
    fillFrom(index, text);
  };

  const value = digits.join("");
  const baseBoxClass =
    "h-14 w-12 rounded-xl border bg-white/70 text-center text-[24px] font-semibold tabular-nums text-ink outline-none transition-[border-color,box-shadow,background] focus:border-[color:var(--color-grasp)] focus:bg-white focus:shadow-[0_0_0_3px_var(--color-grasp-soft)]";
  const borderClass = hasError
    ? "border-red-300 focus:border-red-400 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]"
    : "border-[color:var(--color-line-strong)]";

  return (
    <div className="space-y-3">
      <input
        ref={tokenInput}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        defaultValue={value}
        aria-label={`${length}-digit sign-in code`}
        onChange={(event) => handleTokenInput(event.target.value)}
        onInput={(event) => handleTokenInput(event.currentTarget.value)}
        className="sr-only"
      />
      <div
        className="flex items-center justify-center gap-2 sm:gap-3"
        aria-hidden="true"
        onClick={() => tokenInput.current?.focus()}
      >
        {digits.map((digit, i) => (
          <input
            key={`${groupId}-${i}`}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={1}
            value={digit}
            tabIndex={-1}
            aria-label={`Digit ${i + 1} of ${length}`}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onInput={syncHiddenInput}
            onFocus={(e) => e.currentTarget.select()}
            className={`${baseBoxClass} ${borderClass}`}
          />
        ))}
      </div>
    </div>
  );
}
