import { useState } from "react";
import { api, ClientError, errorCode } from "../api-client";
import { Failure, statusLabel, useRemote } from "./shared";

export function BillingPanel() {
  const { data, error, setError, busy, reload } = useRemote<{
    subscription: { status: string } | null;
  }>("/api/billing/status", { subscription: null });
  const [opening, setOpening] = useState(false);
  const [checkingMember, setCheckingMember] = useState(false);
  const [memberMessage, setMemberMessage] = useState("");
  async function checkMember() {
    setCheckingMember(true);
    setMemberMessage("");
    setError("");
    try {
      const result = await api<{ message: unknown }>("/api/billing/member");
      if (typeof result.message !== "string")
        throw new ClientError("invalid_billing_response");
      setMemberMessage(result.message);
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setCheckingMember(false);
    }
  }
  async function open(kind: "checkout" | "portal") {
    setOpening(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/api/billing/${kind}`, {});
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        !(url.hostname === "polar.sh" || url.hostname.endsWith(".polar.sh"))
      )
        throw new ClientError("invalid_billing_redirect");
      window.location.assign(url.href);
    } catch (caught) {
      setError(errorCode(caught));
      setOpening(false);
    }
  }
  return (
    <>
      <h3>プランと契約</h3>
      <p>
        契約状態：
        {data.subscription ? statusLabel(data.subscription.status) : "契約なし"}
      </p>
      <p className="app-hint">
        手続きはPolarの画面で行います。購入内容・金額・sandbox表示を確認してから確定してください。
      </p>
      <Failure code={error} />
      <div className="button-row">
        <button
          type="button"
          disabled={opening || checkingMember || busy}
          onClick={() => open("checkout")}
        >
          プランを確認
        </button>
        <button
          type="button"
          className="secondary"
          disabled={opening || checkingMember || busy || !data.subscription}
          onClick={() => open("portal")}
        >
          契約を管理
        </button>
        <button
          type="button"
          className="link-button"
          disabled={opening || checkingMember || busy}
          onClick={reload}
        >
          状態を更新
        </button>
        <button
          type="button"
          className="secondary"
          disabled={opening || checkingMember || busy}
          onClick={checkMember}
        >
          {checkingMember ? "確認しています…" : "会員機能を確認"}
        </button>
      </div>
      {memberMessage && <p role="status">{memberMessage}</p>}
    </>
  );
}
