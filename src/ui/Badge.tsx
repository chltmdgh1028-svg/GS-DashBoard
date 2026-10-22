import type { ReactNode } from "react";
import type { CenterHealth, ExceptionState, Severity } from "../domain/types";
import { directionOf, formatSignedPercent } from "../view-models/format";
import { IconArrowDown, IconArrowUp, IconError, IconFlat, IconInfo, IconWarning } from "./icons";

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

/* -------------------------------------------------------------- HealthBadge */

const healthMeta: Record<CenterHealth, { tone: Tone; label: string }> = {
  normal: { tone: "success", label: "정상" },
  warning: { tone: "warning", label: "주의" },
  error: { tone: "danger", label: "조치 필요" },
};

/**
 * Center operating status. A small labelled badge rather than a red row: a
 * table where a third of the rows are red stops meaning anything.
 */
export function HealthBadge({ health, title }: { health: CenterHealth; title?: string }) {
  const meta = healthMeta[health];
  return (
    <Badge tone={meta.tone} size="sm" title={title} icon={<StatusDot tone={meta.tone} />}>
      {meta.label}
    </Badge>
  );
}

/* ------------------------------------------------------ ExceptionStateBadge */

const stateMeta: Record<ExceptionState, { tone: Tone; label: string }> = {
  open: { tone: "danger", label: "미처리" },
  held: { tone: "warning", label: "보류" },
  resolved: { tone: "success", label: "처리 완료" },
  dismissed: { tone: "neutral", label: "해당 없음" },
};

export function ExceptionStateBadge({ state, size = "sm" }: { state: ExceptionState; size?: "sm" | "md" }) {
  const meta = stateMeta[state];
  return (
    <Badge tone={meta.tone} size={size}>
      {meta.label}
    </Badge>
  );
}

/* --------------------------------------------------------- ValidationBadge */

const severityMeta: Record<Severity, { tone: Tone; label: string; Icon: typeof IconError }> = {
  error: { tone: "danger", label: "긴급", Icon: IconError },
  warning: { tone: "warning", label: "주의", Icon: IconWarning },
  info: { tone: "info", label: "참고", Icon: IconInfo },
};

export function ValidationBadge({ severity, size = "sm" }: { severity: Severity; size?: "sm" | "md" }) {
  const meta = severityMeta[severity];
  return (
    <Badge tone={meta.tone} size={size} icon={<meta.Icon size={12} aria-hidden />}>
      {meta.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------- Delta */

/**
 * Change indicator. Always renders an arrow and a signed number so the meaning
 * survives greyscale printing and colour-blind readers.
 */
export function Delta({
  value,
  suffix,
  digits = 1,
  title,
}: {
  value?: number;
  suffix?: string;
  digits?: number;
  title?: string;
}) {
  const dir = directionOf(value);
  const Icon = dir === "up" ? IconArrowUp : dir === "down" ? IconArrowDown : IconFlat;
  return (
    <span className="delta" data-dir={dir} title={title}>
      {dir !== "none" && <Icon size={12} aria-hidden />}
      {formatSignedPercent(value, digits)}
      {suffix}
    </span>
  );
}
