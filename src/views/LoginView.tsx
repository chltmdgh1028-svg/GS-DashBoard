import { useId, useState } from "react";
import type { AuthenticatedUser } from "../domain/types";
import { Button, Field, Input, Notice } from "../ui";
import { IconDashboard, IconError } from "../ui/icons";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

export function LoginView({ onLogin }: { onLogin: (user: AuthenticatedUser) => Promise<void> | void }) {
  const idField = useId();
  const passwordField = useId();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-screen">
      <form
        className="login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const result = await api<{ user: AuthenticatedUser }>("/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, password }),
            });
            await onLogin(result.user);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="login-brand">
          <span className="mark">
            <IconDashboard size={20} aria-hidden />
          </span>
          <h1>전단행사 운영 대시보드</h1>
          <p>본사 ADMIN이 Campaign을 반영하고, OFC는 담당 권역 실적만 조회합니다.</p>
        </div>

        <Field label="아이디" htmlFor={idField}>
          <Input
            id={idField}
            value={userId}
            autoComplete="username"
            autoFocus
            onChange={(event) => setUserId(event.target.value)}
          />
        </Field>
        <Field label="비밀번호" htmlFor={passwordField}>
          <Input
            id={passwordField}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {message && (
          <Notice tone="danger" icon={<IconError size={15} aria-hidden />}>
            <span>{message}</span>
          </Notice>
        )}

        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!userId || !password}>
          로그인
        </Button>
      </form>
    </div>
  );
}
