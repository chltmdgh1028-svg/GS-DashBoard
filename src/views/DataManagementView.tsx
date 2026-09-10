import { useCallback, useEffect, useState } from "react";
import type { CampaignConfig, CampaignListItem, DashboardDataset, FileRole } from "../domain/types";
import { fileRoleLabels, optionalCampaignFileRoles, requiredCampaignFileRoles } from "../domain/fileRoles";
import {
  AgentStatus,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  Input,
  Notice,
  PageHeader,
  SectionCard,
  StepFlow,
  TextCell,
  useToast,
} from "../ui";
import type { StepDefinition } from "../ui";
import {
  IconCheck,
  IconDataManagement,
  IconError,
  IconFile,
  IconFolder,
  IconInfo,
  IconOk,
  IconPublish,
  IconRefresh,
  IconValidation,
  IconWarning,
} from "../ui/icons";
import { formatDateTimeFull, formatNumber, formatRelativeTime } from "../view-models/format";
import { countBySeverity } from "../view-models/validation";

interface AgentHealth {
  ok: boolean;
  agentVersion?: string;
  folderPath: string;
  folderConnected: boolean;
  lastSyncAt?: string;
}

interface ScanFile {
  role: FileRole;
  label: string;
  found: boolean;
  name?: string;
  modifiedAt?: string;
  hash?: string;
  changed?: boolean;
}

interface AgentScan {
  connected: boolean;
  folderPath: string;
  changedSinceLastSync: boolean;
  missingRoles: FileRole[];
  files: ScanFile[];
  rejected?: { name: string; role: FileRole | "error"; reason?: string }[];
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

const AGENT_URL_KEY = "gs-dashboard.agentUrl";
const defaultAgentUrl = "http://127.0.0.1:8787";

export function DataManagementView({
  dataset,
  campaign,
  config,
  onSyncComplete,
  onOpenValidation,
}: {
  dataset?: DashboardDataset;
  campaign?: CampaignListItem;
  config: CampaignConfig;
  onSyncComplete: (dataset: DashboardDataset, generatedAccounts: unknown[], accountCount: number) => Promise<void>;
  onOpenValidation: () => void;
}) {
  const toast = useToast();
  const [agentUrl, setAgentUrl] = useState(() => localStorage.getItem(AGENT_URL_KEY) ?? defaultAgentUrl);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [folderInput, setFolderInput] = useState("");
  const [health, setHealth] = useState<AgentHealth>();
  const [scan, setScan] = useState<AgentScan>();
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agentError, setAgentError] = useState("");

  const agentApi = useCallback(
    async <T,>(pathName: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${agentUrl}${pathName}`, init);
      const data = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) throw new Error(data.error || "Local Agent 요청을 처리하지 못했습니다.");
      return data;
    },
    [agentUrl],
  );

  const checkAgent = useCallback(
    async (announce = false) => {
      setChecking(true);
      setAgentError("");
      try {
        const nextHealth = await agentApi<AgentHealth>("/health");
        setHealth(nextHealth);
        setFolderInput(nextHealth.folderPath);
        const nextScan = await agentApi<AgentScan>("/files");
        setScan(nextScan);
        if (announce) {
          const missing = nextScan.missingRoles.length;
          toast({
            tone: missing ? "warning" : "success",
            title: missing ? `필수 자료 ${formatNumber(missing)}종이 없습니다` : "최신자료 확인 완료",
            description: missing ? "폴더에 최신 파일을 넣고 다시 확인하세요." : nextScan.folderPath,
          });
        }
      } catch (error) {
        setHealth(undefined);
        setScan(undefined);
        setAgentError(error instanceof Error ? error.message : "Local Agent에 연결할 수 없습니다.");
      } finally {
        setChecking(false);
      }
    },
    [agentApi, toast],
  );

  useEffect(() => {
    void checkAgent();
  }, [checkAgent]);

  async function selectFolder() {
    setWorking(true);
    try {
      const result = await agentApi<{ canceled?: boolean; folderPath: string }>("/select-folder", { method: "POST" });
      setFolderInput(result.folderPath);
      if (!result.canceled) {
        toast({ tone: "success", title: "폴더를 저장했습니다", description: result.folderPath });
      }
      await checkAgent();
    } catch (error) {
      toast({ tone: "danger", title: "폴더 선택 실패", description: error instanceof Error ? error.message : "" });
    } finally {
      setWorking(false);
    }
  }

  async function saveFolder() {
    setWorking(true);
    try {
      const result = await agentApi<{ folderPath: string; folderConnected: boolean }>("/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: folderInput }),
      });
      toast({
        tone: result.folderConnected ? "success" : "warning",
        title: result.folderConnected ? "폴더 설정을 저장했습니다" : "폴더를 저장했지만 접근할 수 없습니다",
        description: result.folderPath,
      });
      await checkAgent();
    } catch (error) {
      toast({ tone: "danger", title: "폴더 저장 실패", description: error instanceof Error ? error.message : "" });
    } finally {
      setWorking(false);
    }
  }

  async function publish() {
    setConfirmOpen(false);
    setPublishing(true);
    try {
      const tokenResult = await api<{ token: string }>("/api/admin/local-sync-token", { method: "POST" });
      const syncResult = await agentApi<{
        status: "COMPLETED" | "UNCHANGED";
        message?: string;
        central?: { dataset: DashboardDataset; generatedAccounts: unknown[]; accountCount: number };
      }>("/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenResult.token, centralUrl: window.location.origin, config }),
      });

      if (syncResult.status === "UNCHANGED" || !syncResult.central) {
        toast({
          tone: "info",
          title: "현재 반영된 자료와 동일합니다",
          description: "변경된 파일이 없어 새 Revision을 만들지 않았습니다.",
        });
        await checkAgent();
        return;
      }

      await onSyncComplete(syncResult.central.dataset, syncResult.central.generatedAccounts, syncResult.central.accountCount);
      toast({
        tone: "success",
        title: "Campaign에 반영했습니다",
        description: `신규 OFC 계정 ${formatNumber(syncResult.central.generatedAccounts.length)}개 · 총 계정 ${formatNumber(
          syncResult.central.accountCount,
        )}개`,
      });
      await checkAgent();
    } catch (error) {
      toast({ tone: "danger", title: "Campaign 반영 실패", description: error instanceof Error ? error.message : "" });
    } finally {
      setPublishing(false);
    }
  }

  const online = Boolean(health?.ok);
  const folderConnected = Boolean(health?.folderConnected && scan?.connected);
  const missingRoles = scan?.missingRoles ?? [];
  const filesReady = folderConnected && missingRoles.length === 0;
  const unchanged = filesReady && scan?.changedSinceLastSync === false;
  const canPublish = filesReady && !unchanged;

  const issues = dataset?.issues ?? [];
  const severity = countBySeverity(issues);

  const steps: StepDefinition[] = [
    {
      title: "최신자료 확인",
      state: filesReady ? "done" : "active",
      description: !online
        ? "Local Agent가 실행되어야 폴더를 읽을 수 있습니다."
        : !folderConnected
          ? "연결 폴더를 선택하세요."
          : missingRoles.length > 0
            ? `필수 자료 ${formatNumber(missingRoles.length)}종이 없습니다.`
            : `필수 ${formatNumber(requiredCampaignFileRoles.length)}종을 모두 확인했습니다.`,
      actions: (
        <Button
          variant={filesReady ? "secondary" : "primary"}
          icon={<IconRefresh size={14} aria-hidden />}
          loading={checking}
          onClick={() => void checkAgent(true)}
        >
          최신자료 확인
        </Button>
      ),
    },
    {
      title: "데이터 검증",
      state: filesReady ? "done" : "todo",
      description:
        !dataset
          ? "반영된 Campaign이 없어 검증 결과가 아직 없습니다."
          : severity.error > 0
            ? `최근 반영본에 Error ${formatNumber(severity.error)}건이 있습니다.`
            : `Error 0건 · Warning ${formatNumber(severity.warning)}건 · Info ${formatNumber(severity.info)}건`,
      actions: (
        <Button variant="secondary" icon={<IconValidation size={14} aria-hidden />} onClick={onOpenValidation}>
          검증 결과 보기
        </Button>
      ),
    },
    {
      title: "Campaign 반영",
      state: unchanged ? "done" : canPublish ? "active" : "todo",
      description: unchanged
        ? "현재 반영된 자료와 동일합니다. 새 Revision은 만들어지지 않습니다."
        : canPublish
          ? "변경된 파일을 새 Revision으로 반영합니다."
          : "필수 자료를 모두 확인해야 반영할 수 있습니다.",
      actions: (
        <Button
          variant={canPublish ? "primary" : "secondary"}
          icon={<IconPublish size={14} aria-hidden />}
          disabled={!canPublish}
          loading={publishing}
          onClick={() => setConfirmOpen(true)}
        >
          Campaign 반영
        </Button>
      ),
    },
  ];

  const fileRows = [...requiredCampaignFileRoles, ...optionalCampaignFileRoles].map((role) => {
    const file = scan?.files.find((item) => item.role === role);
    return {
      role,
      required: requiredCampaignFileRoles.includes(role),
      label: fileRoleLabels[role],
      file,
    };
  });

  return (
    <div className="page">
      <PageHeader
        icon={<IconDataManagement size={20} aria-hidden />}
        title="데이터 관리"
        description="이 PC의 Local Agent가 지정 폴더를 읽고, 중앙 서버에는 가공된 Campaign Snapshot만 전송합니다."
        meta={
          <>
            {campaign && (
              <span className="meta-item">
                반영본
                <b>
                  {campaign.campaignName} · R{campaign.activeRevisionNumber ?? 1}
                </b>
              </span>
            )}
            {health?.lastSyncAt && (
              <span className="meta-item">
                마지막 반영
                <b title={formatDateTimeFull(health.lastSyncAt)}>{formatRelativeTime(health.lastSyncAt)}</b>
              </span>
            )}
          </>
        }
        actions={
          <Button icon={<IconRefresh size={14} aria-hidden />} loading={checking} onClick={() => void checkAgent(true)}>
            다시 확인
          </Button>
        }
      />

      <SectionCard flush>
        <AgentStatus
          state={checking && !health ? "checking" : online ? "online" : "offline"}
          version={health?.agentVersion}
          description={
            online ? (
              folderConnected ? (
                `폴더 연결됨 · ${scan?.folderPath}`
              ) : checking ? (
                "폴더의 파일을 확인하는 중입니다…"
              ) : (
                "Agent는 실행 중이지만 설정된 폴더에 접근할 수 없습니다. 폴더를 다시 선택하세요."
              )
            ) : (
              <>
                GS Dashboard Agent를 실행해주세요. 실행 후 <b>다시 확인</b>을 누르면 연결됩니다.
                {agentError && <div className="muted">({agentError})</div>}
              </>
            )
          }
          actions={
            !online && (
              <Button variant="primary" icon={<IconRefresh size={14} aria-hidden />} loading={checking} onClick={() => void checkAgent(true)}>
                다시 확인
              </Button>
            )
          }
        />
      </SectionCard>

      {online && (
        <SectionCard
          title="연결 폴더"
          icon={<IconFolder size={15} aria-hidden />}
          actions={
            <>
              <Button variant="secondary" onClick={() => setShowAdvanced((previous) => !previous)}>
                {showAdvanced ? "간단히" : "고급 설정"}
              </Button>
              <Button variant="primary" icon={<IconFolder size={14} aria-hidden />} loading={working} onClick={selectFolder}>
                폴더 선택
              </Button>
            </>
          }
        >
          <div className="stack" data-gap="sm">
            <div className="path">{scan?.folderPath ?? health?.folderPath ?? "-"}</div>
            {scan && !scan.connected && (
              <Notice tone="warning" icon={<IconWarning size={15} aria-hidden />} title="폴더에 접근할 수 없습니다">
                <span>경로가 이동·삭제되었거나 권한이 없습니다. [폴더 선택]으로 다시 지정하세요.</span>
              </Notice>
            )}
            {showAdvanced && (
              <div className="grid-2">
                <Field label="폴더 경로 직접 입력" hint="Windows 전체 경로를 입력한 뒤 저장하세요.">
                  <div className="row" data-nowrap="true">
                    <Input value={folderInput} onChange={(event) => setFolderInput(event.target.value)} mono />
                    <Button variant="secondary" loading={working} onClick={saveFolder}>
                      저장
                    </Button>
                  </div>
                </Field>
                <Field label="Local Agent 주소" hint="기본값은 http://127.0.0.1:8787 입니다.">
                  <div className="row" data-nowrap="true">
                    <Input value={agentUrl} onChange={(event) => setAgentUrl(event.target.value)} mono />
                    <Button
                      variant="secondary"
                      onClick={() => {
                        localStorage.setItem(AGENT_URL_KEY, agentUrl);
                        void checkAgent(true);
                      }}
                    >
                      적용
                    </Button>
                  </div>
                </Field>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title="작업 흐름" subtitle="최신자료 확인 → 데이터 검증 → Campaign 반영">
        <StepFlow steps={steps} />
      </SectionCard>

      {unchanged && (
        <Notice tone="success" icon={<IconOk size={15} aria-hidden />} title="현재 반영된 자료와 동일합니다">
          <span>마지막 반영 이후 변경된 파일이 없습니다. 파일을 갱신한 뒤 다시 확인하세요.</span>
        </Notice>
      )}

      {online && missingRoles.length > 0 && (
        <Notice tone="danger" icon={<IconError size={15} aria-hidden />} title={`필수 자료 ${formatNumber(missingRoles.length)}종 누락`}>
          <span>{missingRoles.map((role) => fileRoleLabels[role]).join(" · ")}</span>
        </Notice>
      )}

      <SectionCard
        title="파일 상태"
        icon={<IconFile size={15} aria-hidden />}
        subtitle={`필수 ${formatNumber(scan ? requiredCampaignFileRoles.length - missingRoles.length : 0)} / ${formatNumber(
          requiredCampaignFileRoles.length,
        )} 확인`}
        flush
        footer={
          scan?.rejected?.length
            ? `분류되지 않은 파일 ${formatNumber(scan.rejected.length)}개는 무시됩니다: ${scan.rejected
                .slice(0, 4)
                .map((item) => item.name)
                .join(", ")}${scan.rejected.length > 4 ? " 외" : ""}`
            : undefined
        }
      >
        <DataTable
          rows={fileRows}
          rowKey={(row) => row.role}
          density="compact"
          autoHeight
          loading={checking && !scan}
          columns={[
            {
              key: "state",
              header: "상태",
              align: "left",
              width: 92,
              render: (row) =>
                row.file?.found ? (
                  <Badge tone="success" size="sm" icon={<IconCheck size={12} aria-hidden />}>
                    확인
                  </Badge>
                ) : row.required ? (
                  <Badge tone="danger" size="sm" icon={<IconError size={12} aria-hidden />}>
                    누락
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm">
                    선택
                  </Badge>
                ),
            },
            {
              key: "label",
              header: "자료명",
              align: "left",
              width: 190,
              render: (row) => <TextCell value={row.label} width={180} strong />,
            },
            {
              key: "file",
              header: "선택된 파일",
              align: "left",
              width: 300,
              render: (row) =>
                row.file?.name ? <TextCell value={row.file.name} width={290} /> : <span className="muted">-</span>,
            },
            {
              key: "modified",
              header: "수정시간",
              align: "left",
              width: 150,
              render: (row) =>
                row.file?.modifiedAt ? (
                  <span title={formatDateTimeFull(row.file.modifiedAt)}>{formatDateTimeFull(row.file.modifiedAt)}</span>
                ) : (
                  <span className="muted">-</span>
                ),
            },
            {
              key: "changed",
              header: "변경 여부",
              align: "left",
              width: 120,
              render: (row) =>
                !row.file?.found ? (
                  <span className="muted">-</span>
                ) : row.file.changed ? (
                  <Badge tone="accent" size="sm">
                    변경됨
                  </Badge>
                ) : (
                  <span className="muted">동일</span>
                ),
            },
          ]}
          emptyTitle="파일 정보를 불러오지 못했습니다"
          emptyDescription="Local Agent 연결 상태를 먼저 확인하세요."
          caption="필수·선택 자료 파일 상태"
        />
      </SectionCard>

      <ConfirmDialog
        open={confirmOpen}
        title="Campaign에 반영할까요?"
        confirmLabel="반영"
        tone={severity.error > 0 ? "danger" : "primary"}
        busy={publishing}
        onConfirm={() => void publish()}
        onCancel={() => setConfirmOpen(false)}
      >
        <div className="stack" data-gap="sm">
          <p>
            선택된 자료로 <b>{config.campaignName}</b>의 새 Revision을 만듭니다. 동일한 Campaign이면 Revision 번호만
            올라가며, 기존 Revision은 보관됩니다.
          </p>
          {severity.error > 0 && (
            <Notice tone="danger" icon={<IconError size={15} aria-hidden />} title="직전 반영본에 Error가 있습니다">
              <span>
                Error {formatNumber(severity.error)}건이 해결되지 않은 상태입니다. 이번 자료에서도 같은 문제가 반복될 수
                있습니다.
              </span>
            </Notice>
          )}
          <Notice tone="info" icon={<IconInfo size={15} aria-hidden />}>
            <span>파일 내용이 마지막 반영과 완전히 같으면 새 Revision을 만들지 않습니다.</span>
          </Notice>
        </div>
      </ConfirmDialog>
    </div>
  );
}
