export function formatNumber(value?: number, digits = 0) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatWonThousand(value?: number, digits = 0) {
  if (value == null || Number.isNaN(value)) return "-";
  return formatNumber(value / 1000, digits);
}

export function formatPercent(value?: number, digits = 1) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "percent",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function safeDiv(numerator?: number, denominator?: number) {
  if (numerator == null || denominator == null || denominator === 0) return undefined;
  return numerator / denominator;
}
