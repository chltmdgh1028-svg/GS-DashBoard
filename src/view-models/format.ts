/**
 * Presentation-only formatting.
 *
 * Unit policy for the whole dashboard:
 *  - money  : always 천원 (formatWonThousand). The unit is printed in the
 *             column header or the KPI unit slot, never guessed by the reader.
 *  - ratio  : always % with one decimal (formatPercent).
 *  - counts : plain integer with thousand separators.
 *  - change : always sign + arrow (formatSignedPercent + Delta component).
 *
 * These helpers only re-shape values that the verified aggregation layer has
 * already computed. No metric is (re)calculated here.
 */
import { formatNumber, formatPercent, formatWonThousand, safeDiv } from "../utils/format";

export { formatNumber, formatPercent, formatWonThousand, safeDiv };

export type Direction = "up" | "down" | "flat" | "none";

/** Relative change of `current` against `base`, e.g. 0.12 for +12%. */
export function ratioChange(current?: number, base?: number) {
  if (current == null || base == null || base === 0) return undefined;
  return current / base - 1;
}

export function directionOf(value?: number, flatBand = 0.001): Direction {
  if (value == null || Number.isNaN(value)) return "none";
  if (Math.abs(value) < flatBand) return "flat";
  return value > 0 ? "up" : "down";
}

/** "+12.3%" / "-4.5%" / "-" - the sign is part of the string, not just a color. */
export function formatSignedPercent(value?: number, digits = 1) {
  if (value == null || Number.isNaN(value)) return "-";
  const formatted = new Intl.NumberFormat("ko-KR", {
    style: "percent",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Math.abs(value));
  if (Math.abs(value) < 0.001) return `±${formatted}`;
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

export function formatSignedWonThousand(value?: number, digits = 0) {
  if (value == null || Number.isNaN(value)) return "-";
  const formatted = formatWonThousand(Math.abs(value), digits);
  if (value === 0) return formatted;
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

/** Ratio of `value` to `total` clamped to 0..1, for meter widths only. */
export function meterWidth(value?: number) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value)) * 100;
}

export function formatDateTime(iso?: string) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDateTimeFull(iso?: string) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatRelativeTime(iso?: string, now = Date.now()) {
  if (!iso) return "-";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "-";
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}일 전`;
  return formatDateTime(iso);
}

/** Shorten a long Windows path for a single-line display, keeping both ends. */
export function shortenPath(path?: string, head = 18, tail = 28) {
  if (!path) return "-";
  if (path.length <= head + tail + 3) return path;
  return `${path.slice(0, head)}…${path.slice(-tail)}`;
}

/** "+5.2%p" / "-12.0%p" - difference between two percentages. */
export function formatSignedPoint(value?: number, digits = 1) {
  if (value == null || Number.isNaN(value)) return "-";
  const points = value * 100;
  const sign = points > 0 ? "+" : points < 0 ? "-" : "±";
  return `${sign}${Math.abs(points).toFixed(digits)}%p`;
}
