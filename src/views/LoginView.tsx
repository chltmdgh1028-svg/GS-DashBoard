import { useState } from "react";
import type { AuthenticatedUser } from "../domain/types";
import { login } from "../api";
import { Button, Field, Input, Notice } from "../ui";
import { IconError, IconRows } from "../ui/icons";

export function LoginView({ onSignedIn }: { onSignedIn: (user: AuthenticatedUser) => void }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await login(userId.trim(), password);
      onSignedIn(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <IconRows size={24} aria-hidden />
          <strong style={{ fontSize: "var(--fs-lg)" }}>검품 운영 콘솔</strong>
          <span className="muted">Inspection Operations Console</span>
        </div>

        {error && (
          <Notice tone="danger" icon={<IconError size={16} aria-hidden />}>
            {error}
          </Notice>
        )}

        <Field label="아이디" htmlFor="login-user">
          <Input
            id="login-user"
            value={userId}
            autoComplete="username"
            autoFocus
            onChange={(event) => setUserId(event.target.value)}
          />
        </Field>

        <Field label="비밀번호" htmlFor="login-password" hint="검품 운영 관리자 계정으로 로그인합니다.">
          <Input
            id="login-password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!userId.trim() || !password}>
          로그인
        </Button>
      </form>
    </div>
  );
}
