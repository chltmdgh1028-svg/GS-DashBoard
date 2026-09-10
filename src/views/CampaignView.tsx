import { useCallback, useEffect, useState } from "react";
import type { CampaignListItem } from "../domain/types";
import {
  Badge,
  Button,
  CampaignBadge,
  DataTable,
  EmptyState,
  Notice,
  PageHeader,
  SectionCard,
  TextCell,
} from "../ui";
import { IconInfo, IconRevision } from "../ui/icons";
import { formatDateTimeFull, formatNumber, formatRelativeTime } from "../view-models/format";

interface RevisionItem {
  id: string;
  revisionNumber: number;
  createdAt: string;
  active: boolean;
  storeCount: number;
  productCount: number;
  issueCount: number;
}

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin" });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

export function CampaignView({
  campaigns,
  currentCampaignId,
  onOpenCampaign,
}: {
  campaigns: CampaignListItem[];
  currentCampaignId?: string;
  onOpenCampaign: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(currentCampaignId ?? campaigns[0]?.id);
  const [revisions, setRevisions] = useState<RevisionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selected = campaigns.find((item) => item.id === selectedId) ?? campaigns[0];

  const loadRevisions = useCallback(async (campaignId: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ revisions: RevisionItem[] }>(
        `/api/admin/campaigns/${encodeURIComponent(campaignId)}/revisions`,
      );
      setRevisions(result.revisions);
    } catch (caught) {
      setRevisions([]);
      setError(caught instanceof Error ? caught.message : "Revision을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected?.id) void loadRevisions(selected.id);
  }, [selected?.id, loadRevisions]);

  return (
    <div className="page">
      <PageHeader
        icon={<IconRevision size={20} aria-hidden />}
        title="Campaign / Revision"
        description="같은 Campaign을 다시 반영하면 새 Campaign이 아니라 Revision이 하나 올라갑니다. 최신 Revision만 Active로 조회됩니다."
      />

      <Notice tone="info" icon={<IconInfo size={15} aria-hidden />} title="Revision 규칙">
        <span>
          파일 내용이 마지막 반영과 완전히 같으면(SHA-256 동일) 새 Revision을 만들지 않습니다. 이전 Revision은 삭제되지
          않고 이력으로 보관됩니다.
        </span>
      </Notice>

      {campaigns.length === 0 ? (
        <SectionCard>
          <EmptyState
            title="저장된 Campaign이 없습니다"
            description="데이터 관리 화면에서 Local Agent 자료를 반영하면 Campaign이 생성됩니다."
          />
        </SectionCard>
      ) : (
        <div className="grid-2" data-ratio="wide-left">
          <SectionCard title="Campaign" subtitle={`${formatNumber(campaigns.length)}개`} flush>
            <DataTable
              rows={campaigns}
              rowKey={(row) => row.id}
              selectedKey={selected?.id}
              onRowClick={(row) => setSelectedId(row.id)}
              density="compact"
              defaultSort={{ key: "updated", direction: "desc" }}
              columns={[
                {
                  key: "name",
                  header: "행사명",
                  align: "left",
                  sticky: true,
                  width: 210,
                  sortValue: (row) => row.campaignName,
                  render: (row) => (
                    <span className="row" data-nowrap="true">
                      <TextCell value={row.campaignName} width={168} strong />
                      {row.id === currentCampaignId && (
                        <Badge tone="accent" size="sm">
                          조회 중
                        </Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: "active",
                  header: "Active",
                  align: "left",
                  width: 96,
                  sortValue: (row) => row.activeRevisionNumber,
                  render: (row) => <CampaignBadge revisionNumber={row.activeRevisionNumber ?? 1} active />,
                },
                {
                  key: "revisions",
                  header: "Revision",
                  align: "right",
                  width: 84,
                  sortValue: (row) => row.revisionCount,
                  render: (row) => formatNumber(row.revisionCount ?? 1),
                },
                {
                  key: "updated",
                  header: "최신 반영",
                  align: "left",
                  width: 140,
                  sortValue: (row) => row.updatedAt ?? row.createdAt,
                  render: (row) => (
                    <span title={formatDateTimeFull(row.updatedAt ?? row.createdAt)}>
                      {formatDateTimeFull(row.updatedAt ?? row.createdAt)}
                    </span>
                  ),
                },
                {
                  key: "stores",
                  header: "점포",
                  align: "right",
                  width: 74,
                  sortValue: (row) => row.storeCount,
                  render: (row) => formatNumber(row.storeCount),
                },
                {
                  key: "products",
                  header: "상품",
                  align: "right",
                  width: 74,
                  sortValue: (row) => row.productCount,
                  render: (row) => formatNumber(row.productCount),
                },
                {
                  key: "issues",
                  header: "검증 이슈",
                  align: "right",
                  width: 88,
                  sortValue: (row) => row.issueCount,
                  render: (row) =>
                    row.issueCount > 0 ? (
                      <Badge tone="warning" size="sm">
                        {formatNumber(row.issueCount)}
                      </Badge>
                    ) : (
                      <span className="muted">0</span>
                    ),
                },
              ]}
              caption="저장된 Campaign 목록"
            />
          </SectionCard>

          {selected && (
            <SectionCard
              title={selected.campaignName}
              subtitle={`Active Revision: R${selected.activeRevisionNumber ?? 1}`}
              actions={
                <Button
                  variant={selected.id === currentCampaignId ? "secondary" : "primary"}
                  disabled={selected.id === currentCampaignId}
                  onClick={() => onOpenCampaign(selected.id)}
                >
                  {selected.id === currentCampaignId ? "조회 중" : "이 Campaign 조회"}
                </Button>
              }
            >
              {error && (
                <Notice tone="danger" title="Revision을 불러오지 못했습니다">
                  <span>{error}</span>
                </Notice>
              )}
              {loading ? (
                <div className="stack" data-gap="sm">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div className="skeleton" key={index} style={{ height: 34 }} />
                  ))}
                </div>
              ) : (
                <ol className="rev-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {[...revisions]
                    .sort((a, b) => b.revisionNumber - a.revisionNumber)
                    .map((revision) => (
                      <li className="rev-item" key={revision.id} data-active={revision.active ? "true" : undefined}>
                        <span className="rev-no">R{revision.revisionNumber}</span>
                        <span className="rev-meta">
                          <span title={formatDateTimeFull(revision.createdAt)}>
                            {formatDateTimeFull(revision.createdAt)}
                          </span>
                          <span className="muted">{formatRelativeTime(revision.createdAt)}</span>
                          <span className="muted num">
                            점포 {formatNumber(revision.storeCount)} · 이슈 {formatNumber(revision.issueCount)}
                          </span>
                        </span>
                        {revision.active ? (
                          <Badge tone="accent" size="sm">
                            ACTIVE
                          </Badge>
                        ) : (
                          <span className="muted">이력</span>
                        )}
                      </li>
                    ))}
                </ol>
              )}
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
