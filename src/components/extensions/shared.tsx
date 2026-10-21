import { useCallback, useEffect, useState } from "react";
import { api, errorCode, safeCode } from "../api-client";

export function useRemote<T>(path: string, initial: T, revision = 0) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await api<T>(path));
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }, [path]);
  useEffect(() => {
    void revision;
    void reload();
  }, [reload, revision]);
  return { data, error, setError, busy, reload };
}

export function Failure({ code }: { code: string }) {
  return code ? (
    <p className="app-error" role="alert">
      処理できませんでした：{code}
    </p>
  ) : null;
}

const statusLabels: Record<string, string> = {
  pending_index: "検索の準備中",
  ready: "準備完了",
  queued: "受付済み",
  pending: "受付済み",
  running: "処理中",
  completed: "完了",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "取消済み",
  cancel_requested: "取消を依頼済み",
  timed_out: "処理状況の再確認が必要",
  awaiting_approval: "承認待ち",
  approved: "承認済み",
  rejected: "却下済み",
  expired: "期限切れ",
  active: "有効",
  trialing: "試用中",
  past_due: "支払い確認が必要",
  canceled: "解約済み",
  inactive: "無効",
  accepted: "受付済み",
};
export function statusLabel(value: string) {
  return statusLabels[value] ?? safeCode(value);
}
