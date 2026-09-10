import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultCampaignConfig } from "./config/defaultConfig";
import type { AuthenticatedUser, CampaignConfig, CampaignListItem, DashboardDataset } from "./domain/types";
import { adminOnlyViews, defaultViewFor, navigationFor, type ViewId } from "./navigation";
import { Badge, Button, EmptyState, LoadingState, SectionCard, ToastProvider, useToast } from "./ui";
import {
  IconDashboard,
  IconLogout,
  IconOfc,
  IconPanel,
  IconRefresh,
  IconSettings,
  IconStore,
} from "./ui/icons";
import { buildComparisonIndex } from "./view-models/dashboard";
import { formatDateTimeFull, formatRelativeTime } from "./view-models/format";
import { CampaignView } from "./views/CampaignView";
import { DataManagementView } from "./views/DataManagementView";
import { FocusView } from "./views/FocusView";
import { LoginView } from "./views/LoginView";
import { NationalView } from "./views/NationalView";
import { OfcView } from "./views/OfcView";
import { SettingsView } from "./views/SettingsView";
import { StoreView } from "./views/StoreView";
import { TeamView } from "./views/TeamView";
import { ValidationView } from "./views/ValidationView";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

const SIDEBAR_KEY = "gs-dashboard.sidebarCollapsed";

function Shell() {
  const toast = useToast();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewId>("national");
  const [config, setConfig] = useState<CampaignConfig>(() => structuredClone(defaultCampaignConfig));
  const [dataset, setDataset] = useState<DashboardDataset>();
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [selectedTeam, setSelectedTeam] = useState<string>();
  const [selectedOFC, setSelectedOFC] = useState<string>();
  const [selectedStoreId, setSelectedStoreId] = useState<string>();

  const applyDataset = useCallback((next: DashboardDataset) => {
    setDataset(next);
    setSelectedTeam((previous) => previous ?? next.aggregates.teams[0]?.label);
    setSelectedOFC((previous) => previous ?? next.aggregates.ofcs[0]?.label);
    setSelectedStoreId((previous) => previous ?? next.stores[0]?.storeId);
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ dataset: DashboardDataset | null }>("/api/dashboard/latest");
      if (result.dataset) applyDataset(result.dataset);
      const list = await api<{ campaigns: CampaignListItem[] }>("/api/campaigns");
      setCampaigns(list.campaigns);
    } catch (error) {
      toast({ tone: "danger", title: "데이터를 불러오지 못했습니다", description: error instanceof Error ? error.message : "" });
    } finally {
      setLoading(false);
    }
  }, [applyDataset, toast]);

  useEffect(() => {
    api<{ user: AuthenticatedUser | null }>("/api/session")
      .then(async (result) => {
        setUser(result.user);
        if (result.user) {
          setView(defaultViewFor(result.user.role));
          await loadDashboard();
        }
      })
      .catch(() => undefined)
      .finally(() => setBooting(false));
    // Session bootstrap runs once; loadDashboard is stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const comparisonIndex = useMemo(
    () => (dataset ? buildComparisonIndex(dataset) : undefined),
    [dataset],
  );

  const activeCampaign = useMemo(
    () => campaigns.find((item) => item.id === dataset?.config.campaignId),
    [campaigns, dataset?.config.campaignId],
  );

  async function handleLogin(nextUser: AuthenticatedUser) {
    setUser(nextUser);
    setView(defaultViewFor(nextUser.role));
    setSelectedTeam(undefined);
    setSelectedOFC(nextUser.role === "ofc" ? nextUser.ofc : undefined);
    setSelectedStoreId(undefined);
    await loadDashboard();
  }

  async function handleLogout() {
    await api("/api/logout", { method: "POST" });
    setUser(null);
    setDataset(undefined);
    setCampaigns([]);
    setSelectedTeam(undefined);
    setSelectedOFC(undefined);
    setSelectedStoreId(undefined);
  }

  async function openCampaign(id: string) {
    setLoading(true);
    try {
      const result = await api<{ dataset: DashboardDataset }>(`/api/dashboard/${encodeURIComponent(id)}`);
      setDataset(result.dataset);
      setSelectedTeam(result.dataset.aggregates.teams[0]?.label);
      setSelectedOFC(result.dataset.aggregates.ofcs[0]?.label);
      setSelectedStoreId(result.dataset.stores[0]?.storeId);
      setView("national");
    } catch (error) {
      toast({ tone: "danger", title: "Campaign을 열지 못했습니다", description: error instanceof Error ? error.message : "" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncComplete(next: DashboardDataset) {
    setDataset(next);
    if (next.adminConfig) setConfig(next.adminConfig);
    setSelectedTeam(next.aggregates.teams[0]?.label);
    setSelectedOFC(next.aggregates.ofcs[0]?.label);
    setSelectedStoreId(next.stores[0]?.storeId);
    const list = await api<{ campaigns: CampaignListItem[] }>("/api/campaigns");
    setCampaigns(list.campaigns);
    if (next.issues?.some((issue) => issue.severity === "error")) setView("validation");
  }

  if (booting) {
    return (
      <div className="login-screen">
        <div className="state">
          <span className="state-icon">
            <IconDashboard size={20} aria-hidden />
          </span>
          <strong>불러오는 중</strong>
        </div>
      </div>
    );
  }

  if (!user) return <LoginView onLogin={handleLogin} />;

  const isAdmin = user.role === "admin";
  const groups = navigationFor(user.role);
  const currentView: ViewId = !isAdmin && adminOnlyViews.includes(view) ? defaultViewFor(user.role) : view;
  const needsDataset = currentView !== "data" && currentView !== "settings" && currentView !== "campaign";

  return (
    <div className="app-shell" data-collapsed={collapsed ? "true" : undefined}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <IconDashboard size={19} aria-hidden />
          <strong>전단행사 대시보드</strong>
        </div>
        <nav className="sidebar-nav" aria-label="주요 메뉴">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="sidebar-section">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="sidebar-link"
                  aria-current={currentView === item.id ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setView(item.id)}
                >
                  <item.icon size={16} aria-hidden />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span className="avatar">{isAdmin ? <IconSettings size={14} /> : <IconOfc size={14} />}</span>
            <span className="who">
              <strong title={user.displayName}>{user.displayName}</strong>
              <span>{isAdmin ? "ADMIN" : `OFC · ${user.ofc ?? ""}`}</span>
            </span>
          </div>
          <button type="button" onClick={() => void handleLogout()} title="로그아웃">
            <IconLogout size={14} aria-hidden />
            <span>로그아웃</span>
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-toggle"
            onClick={() => setCollapsed((previous) => !previous)}
            aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          >
            <IconPanel size={16} aria-hidden />
          </button>
          <div className="topbar-context">
            {dataset ? (
              <div className="topbar-campaign">
                <strong title={dataset.config.campaignName}>{dataset.config.campaignName}</strong>
                {activeCampaign?.activeRevisionNumber != null && (
                  <Badge tone="accent" size="sm">
                    R{activeCampaign.activeRevisionNumber}
                  </Badge>
                )}
                <span title={formatDateTimeFull(activeCampaign?.updatedAt ?? dataset.createdAt)}>
                  최종 반영 {formatRelativeTime(activeCampaign?.updatedAt ?? dataset.createdAt)}
                </span>
              </div>
            ) : (
              <span className="muted">반영된 Campaign 없음</span>
            )}
          </div>
          <div className="topbar-actions">
            <Button
              variant="secondary"
              size="sm"
              icon={<IconRefresh size={13} aria-hidden />}
              loading={loading}
              onClick={() => void loadDashboard()}
            >
              최신 자료
            </Button>
          </div>
        </header>

        <main className="app-content">
          {loading && !dataset && <LoadingState />}

          {!loading && needsDataset && !dataset && (
            <SectionCard>
              <EmptyState
                icon={<IconStore size={20} aria-hidden />}
                title="반영된 Campaign이 없습니다"
                description={
                  isAdmin
                    ? "데이터 관리 화면에서 Local Agent 자료를 반영하면 전 화면에서 조회할 수 있습니다."
                    : "본사에서 Campaign을 반영하면 담당 점포 실적을 조회할 수 있습니다."
                }
                actions={
                  isAdmin && (
                    <Button variant="primary" onClick={() => setView("data")}>
                      데이터 관리로 이동
                    </Button>
                  )
                }
              />
            </SectionCard>
          )}

          {dataset && comparisonIndex && currentView === "national" && (
            <NationalView
              dataset={dataset}
              campaign={activeCampaign}
              index={comparisonIndex}
              onOpenTeam={(team) => {
                setSelectedTeam(team);
                setView("team");
              }}
            />
          )}

          {dataset && comparisonIndex && currentView === "team" && (
            <TeamView
              dataset={dataset}
              campaign={activeCampaign}
              index={comparisonIndex}
              selectedTeam={selectedTeam}
              onTeamChange={setSelectedTeam}
              onOpenOfc={(team, ofc) => {
                setSelectedTeam(team);
                setSelectedOFC(ofc);
                setView("ofc");
              }}
              onOpenStore={(storeId) => {
                setSelectedStoreId(storeId);
                setView("store");
              }}
            />
          )}

          {dataset && comparisonIndex && currentView === "ofc" && (
            <OfcView
              dataset={dataset}
              campaign={activeCampaign}
              index={comparisonIndex}
              selectedTeam={selectedTeam}
              selectedOFC={selectedOFC ?? user.ofc}
              onScopeChange={(team, ofc) => {
                if (team) setSelectedTeam(team);
                setSelectedOFC(ofc);
              }}
              onOpenStore={(storeId) => {
                setSelectedStoreId(storeId);
                setView("store");
              }}
            />
          )}

          {dataset && currentView === "store" && (
            <StoreView
              dataset={dataset}
              campaign={activeCampaign}
              selectedStoreId={selectedStoreId}
              onSelectStore={setSelectedStoreId}
            />
          )}

          {dataset && currentView === "focus" && (
            <FocusView
              dataset={dataset}
              campaign={activeCampaign}
              onOpenStore={(storeId) => {
                setSelectedStoreId(storeId);
                setView("store");
              }}
            />
          )}

          {isAdmin && currentView === "data" && (
            <DataManagementView
              dataset={dataset}
              campaign={activeCampaign}
              config={config}
              onSyncComplete={handleSyncComplete}
              onOpenValidation={() => setView("validation")}
            />
          )}

          {isAdmin && dataset && currentView === "validation" && (
            <ValidationView dataset={dataset} campaign={activeCampaign} />
          )}

          {isAdmin && currentView === "campaign" && (
            <CampaignView
              campaigns={campaigns}
              currentCampaignId={dataset?.config.campaignId}
              onOpenCampaign={(id) => void openCampaign(id)}
            />
          )}

          {isAdmin && currentView === "settings" && (
            <SettingsView
              config={config}
              onApply={setConfig}
              onReset={() => setConfig(structuredClone(defaultCampaignConfig))}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function OperationsApp() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
