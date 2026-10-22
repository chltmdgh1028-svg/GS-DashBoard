import { useCallback, useEffect, useState } from "react";
import type { AuthenticatedUser } from "./domain/types";
import { fetchSession, logout } from "./api";
import { Badge, Button, Notice, ToastProvider } from "./ui";
import {
  IconExternal,
  IconHistory,
  IconLogout,
  IconMovement,
  IconReceipt,
  IconRows,
  IconSpinner,
  IconUser,
  IconWarning,
} from "./ui/icons";
import { LoginView } from "./views/LoginView";
import { RowsView } from "./views/RowsView";
import { MovementsView } from "./views/MovementsView";
import { HistoryView } from "./views/HistoryView";
import { WriteStatusView } from "./views/WriteStatusView";

type SectionId = "rows" | "movements" | "history" | "writes";

const SECTIONS: { id: SectionId; label: string; Icon: typeof IconRows }[] = [
  { id: "rows", label: "검품 내역", Icon: IconRows },
  { id: "movements", label: "회송 / 교환", Icon: IconMovement },
  { id: "history", label: "이력", Icon: IconHistory },
  { id: "writes", label: "저장 / 복구 상태", Icon: IconReceipt },
];

interface SessionState {
  user: AuthenticatedUser | null;
  correctionsEnabled: boolean;
  adminGridUrl: string | null;
  inspectionBase: string | null;
}

export default function App() {
  const [session, setSession] = useState<SessionState>();
  const [section, setSection] = useState<SectionId>("rows");

  const load = useCallback(() => {
    fetchSession()
      .then(setSession)
      .catch(() =>
        setSession({ user: null, correctionsEnabled: false, adminGridUrl: null, inspectionBase: null }),
      );
  }, []);

  useEffect(load, [load]);

  const handleLogout = useCallback(async () => {
    await logout().catch(() => undefined);
    setSection("rows");
    load();
  }, [load]);

  if (!session) {
    return (
      <div className="login-screen">
        <IconSpinner size={24} className="spin" aria-label="세션 확인 중" />
      </div>
    );
  }

  if (!session.user) return <LoginView onSignedIn={load} />;

  const notConfigured = !session.inspectionBase;

  return (
    <ToastProvider>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <IconRows size={18} aria-hidden />
            <strong>검품 운영 콘솔</strong>
          </div>

          <nav className="sidebar-nav" aria-label="주요 영역">
            <div className="sidebar-section">운영</div>
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sidebar-link"
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => setSection(item.id)}
              >
                <item.Icon size={16} aria-hidden />
                <span>{item.label}</span>
              </button>
            ))}

            {/* 기준정보 is the inspection app's own admin grid. Linked, never
                rebuilt: duplicating its validation would risk the master. */}
            {session.adminGridUrl && (
              <>
                <div className="sidebar-section">기준정보</div>
                <a
                  className="sidebar-link"
                  href={session.adminGridUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="검품 앱의 기준정보 편집 화면으로 이동합니다"
                >
                  <IconExternal size={16} aria-hidden />
                  <span>검품 앱에서 편집</span>
                </a>
              </>
            )}
          </nav>

          <div className="sidebar-foot">
            <div className="sidebar-user">
              <span className="avatar" aria-hidden>
                <IconUser size={14} />
              </span>
              <span className="trunc" style={{ ["--trunc-w" as string]: "150px" }} title={session.user.displayName}>
                {session.user.displayName}
              </span>
            </div>
            <Button variant="ghost" size="sm" icon={<IconLogout size={14} aria-hidden />} onClick={handleLogout}>
              로그아웃
            </Button>
          </div>
        </aside>

        <div className="app-main">
          <header className="topbar">
            <div className="topbar-context">
              <div className="topbar-campaign">
                <strong>{SECTIONS.find((item) => item.id === section)?.label}</strong>
                <span>{notConfigured ? "미연결" : "검품 운영 데이터 원본"}</span>
              </div>
            </div>
            <div className="topbar-actions">
              <Badge tone={session.correctionsEnabled ? "warning" : "neutral"} size="sm">
                {session.correctionsEnabled ? "보정 가능" : "조회 전용"}
              </Badge>
            </div>
          </header>

          <main className="app-content">
            {notConfigured ? (
              <div className="page">
                <Notice tone="warning" icon={<IconWarning size={16} aria-hidden />} title="검품 앱에 연결되지 않았습니다">
                  이 콘솔은 자체 데이터를 보관하지 않습니다. <code>INSPECTION_APP_BASE</code>와{" "}
                  <code>INSPECTION_SESSION_TOKEN</code>을 설정해야 운영 데이터를 조회할 수 있습니다.
                </Notice>
              </div>
            ) : section === "rows" ? (
              <RowsView correctionsEnabled={session.correctionsEnabled} inspectionBase={session.inspectionBase} />
            ) : section === "movements" ? (
              <MovementsView />
            ) : section === "history" ? (
              <HistoryView />
            ) : (
              <WriteStatusView correctionsEnabled={session.correctionsEnabled} />
            )}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
