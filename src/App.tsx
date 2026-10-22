import { useCallback, useEffect, useState } from "react";
import type { AuthenticatedUser } from "./domain/types";
import { fetchSession, logout } from "./api";
import { Button, ToastProvider } from "./ui";
import {
  IconCenter,
  IconDate,
  IconExceptionQueue,
  IconInspection,
  IconInspector,
  IconLogout,
  IconOpsBoard,
  IconSpinner,
} from "./ui/icons";
import { LoginView } from "./views/LoginView";
import { OpsBoardView } from "./views/OpsBoardView";
import { ExceptionQueueView } from "./views/ExceptionQueueView";
import { CentersView } from "./views/CentersView";
import { InspectorsView } from "./views/InspectorsView";
import { InspectionsView } from "./views/InspectionsView";
import { currentBusinessDate } from "./businessDate";

type SectionId = "board" | "queue" | "centers" | "inspectors" | "inspections";

const SECTIONS: { id: SectionId; label: string; Icon: typeof IconOpsBoard; group: string }[] = [
  { id: "board", label: "운영 보드", Icon: IconOpsBoard, group: "현황" },
  { id: "queue", label: "예외 처리", Icon: IconExceptionQueue, group: "현황" },
  { id: "centers", label: "센터", Icon: IconCenter, group: "상세" },
  { id: "inspectors", label: "검품 담당", Icon: IconInspector, group: "상세" },
  { id: "inspections", label: "검품 내역", Icon: IconInspection, group: "상세" },
];

export default function App() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [section, setSection] = useState<SectionId>("board");
  const [date, setDate] = useState(currentBusinessDate());

  useEffect(() => {
    fetchSession()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = useCallback(async () => {
    await logout().catch(() => undefined);
    setUser(null);
    setSection("board");
  }, []);

  if (checking) {
    return (
      <div className="login-screen">
        <IconSpinner size={24} className="spin" aria-label="세션 확인 중" />
      </div>
    );
  }

  if (!user) return <LoginView onSignedIn={setUser} />;

  const groups = [...new Set(SECTIONS.map((item) => item.group))];

  return (
    <ToastProvider>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <IconOpsBoard size={18} aria-hidden />
            <strong>검품 운영 콘솔</strong>
          </div>

          <nav className="sidebar-nav" aria-label="주요 영역">
            {groups.map((group) => (
              <div key={group} style={{ display: "contents" }}>
                <div className="sidebar-section">{group}</div>
                {SECTIONS.filter((item) => item.group === group).map((item) => (
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
              </div>
            ))}
          </nav>

          <div className="sidebar-foot">
            <div className="sidebar-user">
              <span className="avatar" aria-hidden>
                <IconInspector size={14} />
              </span>
              <span className="trunc" style={{ ["--trunc-w" as string]: "150px" }} title={user.displayName}>
                {user.displayName}
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
                <span>{user.role === "admin" ? "전체 센터" : user.center}</span>
              </div>
            </div>
            <div className="topbar-actions">
              <label className="row" style={{ gap: 6 }}>
                <IconDate size={14} aria-hidden />
                <span className="sr-only">운영일</span>
                <input
                  className="input"
                  type="date"
                  value={date}
                  max={currentBusinessDate()}
                  onChange={(event) => setDate(event.target.value || currentBusinessDate())}
                  style={{ width: 150 }}
                />
              </label>
            </div>
          </header>

          <main className="app-content">
            {section === "board" && <OpsBoardView date={date} onOpenQueue={() => setSection("queue")} />}
            {section === "queue" && <ExceptionQueueView date={date} />}
            {section === "centers" && <CentersView date={date} />}
            {section === "inspectors" && <InspectorsView date={date} />}
            {section === "inspections" && <InspectionsView date={date} />}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
