import { useEffect, useRef, useState } from "react";
import { authFailureMessage } from "../lib/auth-errors";
import { api, ClientError, errorCode } from "./api-client";

type Mode = "signin" | "signup" | "forgot" | "reset" | "verify";

export function AuthPanel({
  authMode,
  googleEnabled,
  localDemo,
  onAuthenticated,
  onPasswordReset,
}: {
  authMode: string;
  googleEnabled: boolean;
  localDemo: boolean;
  onAuthenticated: () => Promise<void>;
  onPasswordReset: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const resetToken = useRef("");
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    if (token) {
      resetToken.current = token;
      setMode("reset");
      // tokenを画面・ログ・リンクに出さず、以後のURLからも除く。
      window.history.replaceState(null, "", url.pathname);
    }
  }, []);

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const callbackURL = `${window.location.origin}/app`;
      if (mode === "signin") {
        await api("/api/auth/sign-in/email", { email, password });
        setPassword("");
        await onAuthenticated();
      } else if (mode === "signup") {
        await api("/api/auth/sign-up/email", {
          name: name.trim(),
          email,
          password,
          callbackURL,
        });
        setPassword("");
        setNotice(
          "登録を受け付けました。メールが届いた場合は確認リンクを開き、ログインしてください。",
        );
        setMode("signin");
        await onAuthenticated();
      } else if (mode === "forgot") {
        await api("/api/auth/request-password-reset", {
          email,
          redirectTo: callbackURL,
        });
        setNotice(
          "対象のアカウントがある場合、再設定メールを送ります。受信箱を確認してください。",
        );
      } else if (mode === "verify") {
        await api("/api/auth/send-verification-email", { email, callbackURL });
        setNotice("送信を受け付けました。受信箱を確認してください。");
      } else {
        if (!resetToken.current) throw new ClientError("reset_link_required");
        await api("/api/auth/reset-password", {
          token: resetToken.current,
          newPassword: password,
        });
        resetToken.current = "";
        setPassword("");
        setMode("signin");
        setNotice(
          "パスワードを変更しました。新しいパスワードでログインしてください。",
        );
        onPasswordReset();
      }
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }
  async function googleLogin() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url?: string }>("/api/auth/sign-in/social", {
        provider: "google",
        callbackURL: `${window.location.origin}/app`,
      });
      const target = new URL(result.url ?? "");
      if (
        target.protocol !== "https:" ||
        target.hostname !== "accounts.google.com"
      )
        throw new ClientError("invalid_login_redirect");
      window.location.assign(target.href);
    } catch (caught) {
      setError(errorCode(caught));
      setBusy(false);
    }
  }

  if (authMode === "access")
    return (
      <section className="auth-card">
        <h1>Accessでログイン</h1>
        <p>このアプリは、管理者が許可した利用者向けです。</p>
        <p>Cloudflare Accessのログイン後に、ページを読み込み直してください。</p>
        <button type="button" onClick={() => window.location.reload()}>
          ログイン状態を確認
        </button>
      </section>
    );

  const titles: Record<Mode, string> = {
    signin: "おかえりなさい",
    signup: "アカウントを作成",
    forgot: "パスワードを再設定",
    reset: "新しいパスワード",
    verify: "確認メールを再送",
  };
  return (
    <section className="auth-card">
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1>{titles[mode]}</h1>
      <p>あなたの会話を、次の仕事につなげましょう。</p>
      {localDemo && (
        <p className="app-hint">
          ローカル開発環境です。テスト用のアカウントを作成できます。
        </p>
      )}
      <form onSubmit={submit} className="app-form">
        {mode === "signup" && (
          <label>
            名前
            <input
              autoComplete="name"
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {mode !== "reset" && (
          <label>
            メールアドレス
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {["signin", "signup", "reset"].includes(mode) && (
          <label>
            パスワード
            <input
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "signin" ? 1 : 12}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            {mode !== "signin" && (
              <span className="app-hint">12〜128文字で入力してください。</span>
            )}
          </label>
        )}
        <button type="submit" disabled={busy}>
          {busy
            ? "処理しています…"
            : mode === "signin"
              ? "ログイン"
              : mode === "signup"
                ? "登録する"
                : mode === "reset"
                  ? "パスワードを変更"
                  : "メールを送信"}
        </button>
      </form>
      {error && (
        <p className="app-error" role="alert">
          {authFailureMessage(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="app-notice">
          {notice}
        </p>
      )}
      {googleEnabled && mode === "signin" && (
        <button
          type="button"
          className="secondary full-width"
          disabled={busy}
          onClick={googleLogin}
        >
          Googleでログイン
        </button>
      )}
      <div className="auth-links">
        {mode !== "signin" && (
          <button
            type="button"
            className="link-button"
            disabled={busy}
            onClick={() => changeMode("signin")}
          >
            ログインへ戻る
          </button>
        )}
        {mode === "signin" && (
          <>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => changeMode("signup")}
            >
              新規登録
            </button>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => changeMode("forgot")}
            >
              パスワードを忘れた方
            </button>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => changeMode("verify")}
            >
              確認メールを再送
            </button>
          </>
        )}
      </div>
    </section>
  );
}
