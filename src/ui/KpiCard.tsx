import type { ReactNode } from "react";
import { Delta } from "./Badge";
import { Hint } from "./primitives";
import { directionOf } from "../view-models/format";
import { IconArrowDown, IconArrowUp } from "./icons";

/**
 * Dense KPI tile. Kept small on purpose: an OFC needs to compare six or seven
 * numbers at a glance, so a tile is roughly 150px wide and never pushes the
 * table below the fold on a 1366x768 laptop.
 */
export function KpiCard({
  label,
  value,
  unit,
  hint,
  delta,
  deltaLabel,
  note,
  emphasis,
  footer,
  /** When the value itself IS a change, colour it and prefix an arrow. */
  valueChange,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  delta?: number;
  deltaLabel?: string;
  note?: string;
  emphasis?: boolean;
  footer?: ReactNode;
  valueChange?: number;
}) {
  const direction = valueChange == null ? "none" : directionOf(valueChange);
  const ValueIcon = direction === "up" ? IconArrowUp : direction === "down" ? IconArrowDown : undefined;
  const valueColor =
    direction === "up" ? "var(--pos)" : direction === "down" ? "var(--neg)" : undefined;

  return (
    <div className="kpi" data-emphasis={emphasis ? "primary" : undefined}>
      <div className="kpi-label">
        <span title={label}>{label}</span>
        {hint && <Hint text={hint} />}
      </div>
      <div className="kpi-value" style={valueColor ? { color: valueColor } : undefined}>
        {ValueIcon && <ValueIcon size={16} aria-hidden style={{ alignSelf: "center" }} />}
        <strong style={valueColor ? { color: valueColor } : undefined}>{value}</strong>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {(delta != null || note || footer) && (
        <div className="kpi-foot">
          {delta != null && <Delta value={delta} title={deltaLabel} />}
          {note && (
            <span className="note" title={note}>
              {note}
            </span>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}

export function KpiRow({ cols, children }: { cols?: 4 | 5 | 6; children: ReactNode }) {
  return (
    <div className="kpi-row" data-cols={cols}>
      {children}
    </div>
  );
}
