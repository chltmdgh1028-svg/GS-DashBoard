import type { ReactNode } from "react";
import { Badge, StatusDot } from "./Badge";
import { IconAgent } from "./icons";

export type AgentState = "online" | "offline" | "checking";

const stateMeta: Record<AgentState, { label: string; tone: "success" | "danger" | "neutral" }> = {
  online: { label: "연결됨", tone: "success" },
  offline: { label: "연결 안 됨", tone: "danger" },
  checking: { label: "확인 중", tone: "neutral" },
};

/**
 * Local Agent connection banner.
 *
 * When the agent is down this must read as "here is what to do next", not as a
 * stack trace: the admin's job is to launch the agent, not to debug a fetch.
 */
export function AgentStatus({
  state,
  description,
  version,
  actions,
}: {
  state: AgentState;
  description: ReactNode;
  version?: string;
  actions?: ReactNode;
}) {
  const meta = stateMeta[state];
  return (
    <div className="agent-status" data-state={state}>
      <span className="agent-icon">
        <IconAgent size={19} aria-hidden />
      </span>
      <div className="agent-main">
        <div className="agent-title">
          Local Agent
          <Badge tone={meta.tone} size="sm" icon={<StatusDot tone={meta.tone} />}>
            {meta.label}
          </Badge>
          {version && (
            <Badge tone="neutral" size="sm">
              v{version}
            </Badge>
          )}
        </div>
        <div className="agent-desc">{description}</div>
      </div>
      {actions && <div className="row" data-nowrap="true">{actions}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- Workflow */

export interface StepDefinition {
  title: string;
  description: ReactNode;
  state: "todo" | "active" | "done";
  actions?: ReactNode;
}

/** 최신자료 확인 → 데이터 검증 → Campaign 반영 */
export function StepFlow({ steps }: { steps: StepDefinition[] }) {
  return (
    <ol className="steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((step, index) => (
        <li className="step" key={step.title} data-state={step.state}>
          <span className="step-index" aria-hidden>
            {step.state === "done" ? "✓" : index + 1}
          </span>
          <div className="step-main">
            <strong>{step.title}</strong>
            <span>{step.description}</span>
            {step.actions && <div className="step-actions">{step.actions}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
