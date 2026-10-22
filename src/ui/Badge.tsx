import type { ReactNode } from "react";
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/* ------------------------------------------------------------------- Badge */

export function Badge({
  tone = "neutral",
  variant = "soft",
  size = "md",
  icon,
  title,
  children,
}: {
  tone?: Tone;
  variant?: "soft" | "solid";
  size?: "sm" | "md";
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className="badge" data-tone={tone} data-variant={variant} data-size={size} title={title}>
      {icon}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- StatusDot */

export function StatusDot({ tone = "neutral" }: { tone?: Tone }) {
  return <span className="dot" data-tone={tone} aria-hidden />;
}
