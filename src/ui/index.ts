/** Shared UI kit. Screens import from here, never from the individual files. */
export { Badge, CampaignBadge, Delta, StatusBadge, StatusDot, ValidationBadge } from "./Badge";
export type { StatusKind, Tone } from "./Badge";
export { AgentStatus, StepFlow } from "./AgentStatus";
export type { AgentState, StepDefinition } from "./AgentStatus";
export { DataTable, MeterCell, TextCell } from "./DataTable";
export type { Column, DataTableProps } from "./DataTable";
export { KpiCard, KpiRow } from "./KpiCard";
export { ConfirmDialog } from "./Modal";
export {
  DefinitionList,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaItem,
  Notice,
  PageHeader,
  SectionCard,
} from "./layout";
export { Button, Field, Hint, Input, SearchInput, Segmented, Select, Textarea } from "./primitives";
export { ToastProvider, useToast } from "./Toast";
