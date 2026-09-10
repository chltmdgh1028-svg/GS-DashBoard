import type { ReactNode } from "react";
import type { Severity } from "../domain/types";
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

/* ------------------------------------------------------------- StatusBadge */

export type StatusKind = "good" | "watch" | "action" | "nodata";

const statusMeta: Record<StatusKind, { tone: Tone; label: string }> = {
  good: { tone: "success", label: "양호" },
  watch: { tone: "warning", label: "관찰" },
  action: { tone: "danger", label: "우선 코칭" },
  nodata: { tone: "neutral", label: "데이터 없음" },
};

/**
 * Coaching status. Deliberately a small labelled badge instead of a red row:
 * a table where a third of the rows are red stops meaning anything.
 */
export function StatusBadge({ status, title }: { status: StatusKind; title?: string }) {
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone} size="sm" title={title} icon={<StatusDot tone={meta.tone} />}>
      {meta.label}
    </Badge>
  );
}

/* --------------------------------------------------------- ValidationBadge */

const severityMeta: Record<Severity, { tone: Tone; label: string; Icon: typeof IconError }> = {
  error: { tone: "danger", label: "Error", Icon: IconError },
  warning: { tone: "warning", label: "Warning", Icon: IconWarning },
  info: { tone: "info", label: "Info", Icon: IconInfo },
};

export function ValidationBadge({ severity, size = "sm" }: { severity: Severity; size?: "sm" | "md" }) {
  const meta = severityMeta[severity];
  return (
    <Badge tone={meta.tone} size={size} icon={<meta.Icon size={12} aria-hidden />}>
      {meta.label}
    </Badge>
  );
}

/* ----------------------------------------------------------- CampaignBadge */

/** "R2 · ACTIVE" chip used wherever a revision is referenced. */
export function CampaignBadge({
  revisionNumber,
  active,
  size = "sm",
}: {
  revisionNumber?: number;
  active?: boolean;
  size?: "sm" | "md";
}) {
  if (revisionNumber == null) return null;
  return (
    <Badge tone={active ? "accent" : "neutral"} size={size} title={active ? "현재 조회 중인 Revision" : undefined}>
      R{revisionNumber}
      {active ? " · ACTIVE" : ""}
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
