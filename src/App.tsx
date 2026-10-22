import { useCallback, useEffect, useState } from "react";
import type { AuthenticatedUser, DatasetEntry } from "./domain/types";
import { fetchDatasets, fetchHealth, fetchSession, logout } from "./api";
import { useResource } from "./useResource";
import { Badge, Button, Notice, ToastProvider } from "./ui";
import { IconError, IconLogout, IconMaster, IconSpinner, IconUser, IconWarning } from "./ui/icons";
import { LoginView } from "./views/LoginView";
import { MasterConsoleView, NoDatasetSelected } from "./views/MasterConsoleView";

export default function App() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    fetchSession()
      .then((result) => {
        setUser(result.user);
        setWritesEnabled(result.writesEnabled);
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = useCallback(async () => {
    await logout().catch(() => undefined);
    setUser(null);
    setSelected(undefined);
  }, []);

  if (checking) {
    return (
      <div className="login-screen">
        <IconSpinner size={24} className="spin" aria-label="세션 확인 중" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onSignedIn={(signedIn) => {
          setUser(signedIn);
          fetchSession()
            .then((result) => setWritesEnabled(result.writesEnabled))
            .catch(() => undefined);
        }}
      />
    );
  }

  return (
    <ToastProvider>
      <Shell user={user} writesEnabled={writesEnabled} selected={selected} onSelect={setSelected} onLogout={handleLogout} />
    </ToastProvider>
  );
}

function Shell({
  user,
  writesEnabled,
  selected,
  onSelect,
  onLogout,
}: {
  user: AuthenticatedUser;
  writesEnabled: boolean;
  selected?: string;
  onSelect: (name: string) => void;
  onLogout: () => void;
}) {
  const catalog = useResource(() => fetchDatasets(), "datasets");
  const health = useResource(() => fetchHealth(), "health");

  const datasets: DatasetEntry[] = catalog.data?.datasets ?? [];
  const entry = datasets.find((item) => item.name === selected);
  const notConfigured = health.data?.inspectionApiConfigured === false;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <IconMaster size={18} aria-hidden />
          <strong>검품 마스터 콘솔</strong>
        </div>

        <nav className="sidebar-nav" aria-label="데이터셋">
          <div className="sidebar-section">데이터셋</div>

          {catalog.loading && !catalog.data && (
            <span className="sidebar-link" aria-busy="true">
              <IconSpinner size={14} className="spin" aria-hidden />
              <span>불러오는 중</span>
            </span>
          )}

          {catalog.error && (
            <span className="sidebar-link" title={catalog.error}>
              <IconError size={14} aria-hidden />
              <span>목록을 불러올 수 없음</span>
            </span>
          )}

          {datasets.map((item) => (
            <button
              key={item.name}
              type="button"
              className="sidebar-link"
              aria-current={selected === item.name ? "page" : undefined}
              title={item.name}
              onClick={() => onSelect(item.name)}
            >
              <IconMaster size={16} aria-hidden />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span className="avatar" aria-hidden>
              <IconUser size={14} />
            </span>
            <span className="trunc" style={{ ["--trunc-w" as string]: "150px" }} title={user.displayName}>
              {user.displayName}
            </span>
          </div>
          <Button variant="ghost" size="sm" icon={<IconLogout size={14} aria-hidden />} onClick={onLogout}>
            로그아웃
          </Button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-context">
            <div className="topbar-campaign">
              <strong>{entry?.label ?? "검품 마스터 콘솔"}</strong>
              <span>{notConfigured ? "미연결" : "검품 운영 데이터 원본"}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <Badge tone={writesEnabled ? "warning" : "neutral"} size="sm">
              {writesEnabled ? "수정 가능" : "읽기 전용"}
            </Badge>
          </div>
        </header>

        <main className="app-content">
          {notConfigured ? (
            <div className="page">
              <Notice
                tone="warning"
                icon={<IconWarning size={16} aria-hidden />}
                title="검품 앱에 연결되지 않았습니다"
              >
                이 콘솔은 자체 데이터를 보관하지 않습니다. 아래 환경변수를 설정해야 정규 기준정보를 조회할 수
                있습니다.
                <br />
                <code>{(health.data?.missingInspectionVars ?? []).join(", ") || "INSPECTION_APP_BASE, INSPECTION_SESSION_TOKEN"}</code>
              </Notice>
            </div>
          ) : entry ? (
            <MasterConsoleView entry={entry} writesEnabled={writesEnabled} />
          ) : (
            <NoDatasetSelected datasets={datasets} />
          )}
        </main>
      </div>
    </div>
  );
}
