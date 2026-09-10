import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId, useState } from "react";
import { IconClose, IconHelp, IconSearch, IconSpinner } from "./icons";

/* ------------------------------------------------------------------ Button */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
}

/**
 * The only button in the app. Loading state keeps the label so the control
 * never changes width mid-click, and disables itself so a second submit is
 * impossible.
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  iconOnly = false,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`btn ${rest.className ?? ""}`.trim()}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-icon-only={iconOnly || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <IconSpinner size={14} className="spin" aria-hidden /> : icon}
      {!iconOnly && children}
    </button>
  );
}

/* ------------------------------------------------------------------- Field */

export function Field({
  label,
  hint,
  hintTone,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: ReactNode;
  hintTone?: "default" | "error";
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && (
        <span className="hint" data-tone={hintTone === "error" ? "error" : undefined}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Input({ mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input {...rest} className={`input ${rest.className ?? ""}`.trim()} data-mono={mono || undefined} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ""}`.trim()} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ""}`.trim()} />;
}

/* ------------------------------------------------------------- SearchInput */

export function SearchInput({
  value,
  onChange,
  placeholder,
  width,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
  label: string;
}) {
  const id = useId();
  return (
    <div className="search">
      <IconSearch size={14} aria-hidden />
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        style={width ? { width } : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="검색어 지우기">
          <IconClose size={13} />
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode; count?: number }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
          {option.count != null && <span className="num">({option.count})</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Tooltip */

/**
 * Small "what does this number mean" affordance. Keyboard reachable and shown
 * on focus as well as hover, so the definition is not mouse-only.
 */
export function Hint({ text, align = "center" }: { text: string; align?: "center" | "end" }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="hint"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((previous) => !previous)}
      >
        <IconHelp size={13} />
      </button>
      {open && (
        <span className="hint-bubble" role="tooltip" data-align={align === "end" ? "end" : undefined}>
          {text}
        </span>
      )}
    </span>
  );
}
