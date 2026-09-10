import { useMemo, useState } from "react";
import type { CampaignListItem, DashboardDataset, Severity } from "../domain/types";
import {
  DataTable,
  DefinitionList,
  EmptyState,
  PageHeader,
  SearchInput,
  SectionCard,
  Segmented,
  TextCell,
  ValidationBadge,
} from "../ui";
import { IconOk, IconValidation } from "../ui/icons";
import { formatNumber } from "../view-models/format";
import { categoryLabels, countBySeverity, groupIssues } from "../view-models/validation";
import { CampaignMeta } from "./shared";

type SeverityFilter = "all" | Severity;

/** Clickable summary tile that doubles as the severity filter. */
function SummaryTile({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: "danger" | "warning" | "info" | "neutral";
  active: boolean;
  onClick: () => void;
}) {
  const color =
    tone === "danger"
      ? "var(--c-danger-600)"
      : tone === "warning"
        ? "var(--c-warning-600)"
        : tone === "info"
          ? "var(--accent)"
          : "var(--text-secondary)";
  return (
    <button
      type="button"
      className="kpi"
      aria-pressed={active}
      onClick={onClick}
      style={{
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        borderColor: active ? color : undefined,
        boxShadow: active ? `var(--sh-xs), inset 3px 0 0 ${color}` : undefined,
        paddingLeft: active ? "calc(var(--s-3) + 3px)" : undefined,
      }}
    >
      <span className="kpi-label">
        <span>{label}</span>
      </span>
      <span className="kpi-value">
        <strong style={{ color: count > 0 ? color : "var(--text-muted)" }}>{formatNumber(count)}</strong>
        <span className="unit">건</span>
      </span>
    </button>
  );
}

export function ValidationView({
  dataset,
  campaign,
}: {
  dataset: DashboardDataset;
  campaign?: CampaignListItem;
}) {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>();

  const issues = useMemo(() => dataset.issues ?? [], [dataset.issues]);
  const counts = countBySeverity(issues);
  const groups = useMemo(() => groupIssues(issues), [issues]);

  const categoryOptions = useMemo(() => {
    const used = new Set(groups.map((group) => group.category));
    return [
      { value: "all", label: "전체 분류" },
      ...Object.entries(categoryLabels)
        .filter(([key]) => used.has(key as keyof typeof categoryLabels))
        .map(([key, label]) => ({ value: key, label })),
    ];
  }, [groups]);

  const visibleGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (severity !== "all" && group.severity !== severity) return false;
      if (category !== "all" && group.category !== category) return false;
      if (!keyword) return true;
      return `${group.title} ${group.items.map((item) => item.detail).join(" ")}`.toLowerCase().includes(keyword);
    });
  }, [groups, severity, category, query]);

  const selected = visibleGroups.find((group) => `${group.severity}|${group.category}|${group.title}` === selectedKey) ?? visibleGroups[0];

  return (
    <div className="page">
      <PageHeader
        icon={<IconValidation size={20} aria-hidden />}
        title="데이터 검증"
        description="현재 반영된 Revision의 검증 결과입니다. 항목을 선택하면 원인과 확인할 내용이 표시됩니다."
        meta={<CampaignMeta dataset={dataset} campaign={campaign} />}
      />

      <div className="kpi-row" data-cols="4">
        <SummaryTile
          label="Error · 반영 전 확인 필요"
          count={counts.error}
          tone="danger"
          active={severity === "error"}
          onClick={() => setSeverity(severity === "error" ? "all" : "error")}
        />
        <SummaryTile
          label="Warning · 확인 권장"
          count={counts.warning}
          tone="warning"
          active={severity === "warning"}
          onClick={() => setSeverity(severity === "warning" ? "all" : "warning")}
        />
        <SummaryTile
          label="Info · 참고"
          count={counts.info}
          tone="info"
          active={severity === "info"}
          onClick={() => setSeverity(severity === "info" ? "all" : "info")}
        />
        <SummaryTile
          label="검증 대상 파일"
          count={Object.keys(dataset.fileRoles ?? {}).length}
          tone="neutral"
          active={severity === "all"}
          onClick={() => setSeverity("all")}
        />
      </div>

      {issues.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={<IconOk size={20} aria-hidden />}
            title="검증 이슈가 없습니다"
            description="현재 반영본에서 확인이 필요한 항목이 발견되지 않았습니다."
          />
        </SectionCard>
      ) : (
        <div className="grid-2" data-ratio="wide-left">
          <SectionCard title="검증 항목" subtitle={`${formatNumber(visibleGroups.length)}종`} flush>
            <DataTable
              rows={visibleGroups}
              rowKey={(row) => `${row.severity}|${row.category}|${row.title}`}
              selectedKey={selected ? `${selected.severity}|${selected.category}|${selected.title}` : undefined}
              onRowClick={(row) => setSelectedKey(`${row.severity}|${row.category}|${row.title}`)}
              density="compact"
              defaultSort={{ key: "count", direction: "desc" }}
              toolbar={
                <>
                  <div className="table-toolbar-group">
                    <Segmented
                      label="분류 필터"
                      value={category}
                      onChange={setCategory}
                      options={categoryOptions}
                    />
                  </div>
                  <div className="table-toolbar-group">
                    <SearchInput label="검증 항목 검색" value={query} onChange={setQuery} placeholder="항목 · 내용" width={170} />
                  </div>
                </>
              }
              columns={[
                {
                  key: "severity",
                  header: "등급",
                  align: "left",
                  width: 92,
                  sortValue: (row) => ({ error: 0, warning: 1, info: 2 })[row.severity],
                  render: (row) => <ValidationBadge severity={row.severity} />,
                },
                {
                  key: "title",
                  header: "문제",
                  align: "left",
                  width: 230,
                  sortValue: (row) => row.title,
                  render: (row) => <TextCell value={row.title} width={220} strong />,
                },
                {
                  key: "category",
                  header: "분류",
                  align: "left",
                  width: 150,
                  sortValue: (row) => categoryLabels[row.category],
                  render: (row) => <TextCell value={categoryLabels[row.category]} width={140} />,
                },
                {
                  key: "count",
                  header: "건수",
                  align: "right",
                  width: 70,
                  sortValue: (row) => row.count,
                  render: (row) => formatNumber(row.count),
                },
              ]}
              emptyTitle="조건에 맞는 검증 항목이 없습니다"
              caption="검증 항목 요약"
            />
          </SectionCard>

          {selected && (
            <SectionCard
              title={selected.title}
              subtitle={`${categoryLabels[selected.category]} · ${formatNumber(selected.count)}건`}
              actions={<ValidationBadge severity={selected.severity} size="md" />}
            >
              <div className="stack" data-gap="sm">
                <DefinitionList
                  items={[
                    { term: "원인", value: selected.guide.cause },
                    { term: "영향", value: selected.guide.impact },
                    { term: "확인할 내용", value: selected.guide.checklist },
                  ]}
                />
                <DataTable
                  rows={selected.items.slice(0, 200)}
                  rowKey={(row, index) => `${row.entityId ?? "-"}-${index}`}
                  density="compact"
                  maxHeight={320}
                  columns={[
                    {
                      key: "entity",
                      header: "대상",
                      align: "left",
                      width: 96,
                      render: (row) => <span className="mono">{row.entityId ?? "-"}</span>,
                    },
                    {
                      key: "detail",
                      header: "상세 내용",
                      align: "left",
                      render: (row) => <TextCell value={row.detail} width={420} />,
                    },
                  ]}
                  caption={`${selected.title} 대상 목록`}
                />
                {selected.items.length > 200 && (
                  <p className="muted">상위 200건만 표시합니다. (전체 {formatNumber(selected.items.length)}건)</p>
                )}
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
