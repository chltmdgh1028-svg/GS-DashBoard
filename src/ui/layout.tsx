import type { ReactNode } from "react";
import { IconEmpty, IconError, IconWarning } from "./icons";
import type { Tone } from "./Badge";

/* -------------------------------------------------------------- PageHeader */

export function PageHeader({
  icon,
  title,
  description,
  meta,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Campaign / revision / freshness context - rendered as a meta strip. */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        <h1>
          {icon}
          {title}
        </h1>
        {description && <p>{description}</p>}
        {meta && <div className="page-header-meta">{meta}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

export function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="meta-item">
      {label}
      <b>{children}</b>
    </span>
  );
}

/* ------------------------------------------------------------- SectionCard */

export function SectionCard({
  title,
  subtitle,
  icon,
  actions,
  footer,
  flush,
  children,
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Set for tables, which bring their own padding. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          <div className="card-head-main">
            {icon}
            {title && <h2>{title}</h2>}
            {subtitle && <span className="sub">{subtitle}</span>}
          </div>
          {actions && <div className="card-head-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body" data-flush={flush ? "true" : undefined}>
        {children}
      </div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  actions,
  inline,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className="state" data-inline={inline ? "true" : undefined}>
      <span className="state-icon">{icon ?? <IconEmpty size={20} aria-hidden />}</span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- ErrorState */

export function ErrorState({
  title,
  description,
  actions,
  tone = "danger",
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  tone?: "danger" | "warning";
}) {
  return (
    <div className="state" data-tone={tone}>
      <span className="state-icon">
        {tone === "danger" ? <IconError size={20} aria-hidden /> : <IconWarning size={20} aria-hidden />}
      </span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ LoadingState */

export function LoadingState({ label = "불러오는 중" }: { label?: string }) {
  return (
    <div className="stack" data-gap="sm" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="kpi-row" data-cols="4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="kpi" key={index}>
            <div className="skeleton" style={{ height: 11, width: "55%" }} />
            <div className="skeleton" style={{ height: 22, width: "75%", marginTop: 6 }} />
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-body">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="skeleton" key={index} style={{ height: 12, margin: "10px 0" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Notice */

export function Notice({
  tone = "info",
  icon,
  title,
  children,
  actions,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="notice" data-tone={tone} role={tone === "danger" ? "alert" : undefined}>
      {icon}
      <div className="notice-body">
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/* --------------------------------------------------------- Definition list */

export function DefinitionList({ items }: { items: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="dl">
      {items.map((item) => (
        <div key={item.term} style={{ display: "contents" }}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
