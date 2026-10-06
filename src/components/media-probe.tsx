import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorCode } from "./api-client";

interface ProbeState {
  isSynthetic?: boolean;
  requestId: string | null;
  startedAt: number;
  expiresAt: number;
  reconciliationUntil: number;
  usedAttempts: number;
  canSubmit: boolean;
  isStopped: boolean;
  job: null | {
    id: string;
    providerState: string;
    collectionState: string;
    terminalOutcome: string | null;
    isUncertain: boolean;
    assets: { id: string; state: string }[];
  };
  evidence: { item: string; verdict: string }[];
}
const ITEM_LABELS: Record<string, string> = {
  acl: "出力の公開範囲",
  anonymous: "匿名取得の拒否",
  token: "短期tokenの失効",
  expiry: "1時間後の取得不可",
  quality: "画像の用途適合（本人確認）",
  billing: "課金の照合（本人確認）",
  upstream_delete: "上流削除（本人の実施報告）",
};
const VERDICT_LABELS: Record<string, string> = {
  pass: "確認済み",
  fail: "不適合",
  unknown: "不明",
  not_due: "確認時刻前",
};
export function MediaProbe() {
  const [state, setState] = useState<ProbeState | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState("読込中です。");
  const observation = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await api<ProbeState>("/api/media-probe"));
      setNotice("");
    } catch (error) {
      setNotice(
        errorCode(error) === "media_probe_disabled"
          ? "限定接続はOFFです。実接続の承認・設定が揃うまで送信できません。"
          : "認証・限定承認・状態を確認できません。新しい要求を送らず、設定と停止状態を確認してください。",
      );
      setState(null);
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => observation.current?.abort();
  }, [reload]);
  async function perform(path: string, body: unknown = {}) {
    setIsBusy(true);
    try {
      await api(path, body);
      if (path === "/api/media-probe/close") {
        setState(null);
        setNotice(
          "アプリ内の確認経路を閉鎖しました。Access側の閉鎖・session失効・ログアウトは担当者が別に確認してください。",
        );
        return;
      }
      await reload();
    } catch {
      await reload();
      setNotice(
        "操作の完了を確認できません。同じ要求の状態を確認し、新規生成で再試行しないでください。",
      );
    } finally {
      setIsBusy(false);
    }
  }
  function jobPath(operation: string) {
    return `/api/media-probe/jobs/${state?.job?.id}/${operation}`;
  }
  async function observeToken() {
    const controller = new AbortController();
    observation.current = controller;
    setIsBusy(true);
    setNotice("短期tokenの期限を観測中です。最大約6分かかります。");
    try {
      const response = await fetch(jobPath("token-observation"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("observation_unavailable");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("observation_unavailable");
      try {
        while (!(await reader.read()).done) {
          /* 判定はDBの状態で読み直す。 */
        }
      } finally {
        reader.releaseLock();
      }
      await reload();
    } catch {
      await reload();
      setNotice(
        "期限観測が中断または不明になりました。新規送信やtoken再発行で救済しません。",
      );
    } finally {
      observation.current = null;
      setIsBusy(false);
    }
  }
  return (
    <main className="container section" id="main">
      <h1>限定接続の確認</h1>
      {state?.isSynthetic && (
        <p className="app-notice">
          合成fixtureです。実fal未使用・期限観測は時間短縮で検証します。
        </p>
      )}
      <p>
        本人1名の架空Web画像を1要求だけ生成します。通常のモデル利用は有効にしません。
      </p>
      <section className="resource-card">
        <h2>送信内容</h2>
        <p>Sunburst · 1024×1024 · medium · PNG · 不透明背景 · 1枚</p>
        <p>
          白背景に青い陶器の立方体、黄色い紙の円柱、緑のガラス球を並べた静物。文字・人物・ロゴなし。
        </p>
        <button
          type="button"
          disabled={isBusy || !state?.canSubmit || !state.requestId}
          onClick={() =>
            void perform("/api/media-probe/jobs", {
              slot: 1,
              requestId: state?.requestId,
            })
          }
        >
          固定内容で1回生成
        </button>
        <p className="app-hint">
          送信窓は固定30分。失敗や不明も消費し、再起動や再読込で枠を戻しません。今回は2回目を送りません。
        </p>
      </section>
      {notice && (
        <p className="app-notice" role="status">
          {notice}
        </p>
      )}
      <div className="media-probe-actions">
        <button type="button" disabled={isBusy} onClick={() => void reload()}>
          保存状態を確認
        </button>
        {state && (
          <button
            type="button"
            onClick={() => void perform("/api/media-probe/stop")}
          >
            新規受付を停止
          </button>
        )}
        {observation.current && (
          <button type="button" onClick={() => observation.current?.abort()}>
            期限観測を中断
          </button>
        )}
      </div>
      {state && (
        <section className="resource-card">
          <h2>固定窓と消費</h2>
          <p>
            開始{" "}
            {new Date(state.startedAt).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}{" "}
            / 送信締切{" "}
            {new Date(state.expiresAt).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}{" "}
            JST
          </p>
          <p>
            消費 {state.usedAttempts}要求 / 今回の送信許可 1要求 / 総上限 2要求
          </p>
          <p>
            {state.isStopped
              ? "新規受付は停止しています。同じ要求の回収・照合だけを続けます。"
              : "未送信です。"}
          </p>
        </section>
      )}
      {state?.job && (
        <section className="resource-card">
          <h2>同じ要求の回収と照合</h2>
          <p>
            上流: {state.job.providerState} / 回収: {state.job.collectionState}
          </p>
          {state.job.isUncertain && (
            <p className="app-error">
              受付または結果が不明です。消費と同時枠を保持しています。
            </p>
          )}
          <div className="media-probe-actions">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void perform(jobPath("cleanup-status"))}
            >
              終了後の上流状態を照合
            </button>
            <button
              type="button"
              disabled={isBusy || !!state.job.terminalOutcome}
              onClick={() => void perform(jobPath("refresh"))}
            >
              上流状態と回収を確認
            </button>
            <button
              type="button"
              disabled={isBusy || !!state.job.terminalOutcome}
              onClick={() => void perform(jobPath("cancel"))}
            >
              取消を依頼
            </button>
            <button
              type="button"
              disabled={isBusy || state.job.terminalOutcome !== "stored"}
              onClick={() => void perform(jobPath("acl"))}
            >
              公開範囲を確認
            </button>
            <button
              type="button"
              disabled={
                isBusy ||
                state.job.terminalOutcome !== "stored" ||
                state.evidence.some((item) => item.item === "token")
              }
              onClick={() => void observeToken()}
            >
              短期tokenの期限を観測
            </button>
            <button
              type="button"
              disabled={isBusy || state.job.terminalOutcome !== "stored"}
              onClick={() => void perform(jobPath("expiry"))}
            >
              1時間後の期限を照合
            </button>
          </div>
          {state.job.assets
            .filter((asset) => asset.state === "ready")
            .map((asset) => (
              <div key={asset.id}>
                <img
                  src={`/api/media/assets/${asset.id}/file`}
                  alt="本人限定の生成結果"
                  width="384"
                  height="384"
                  style={{ maxWidth: "100%", height: "auto" }}
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void perform(jobPath(`assets/${asset.id}`))}
                >
                  この出力を削除
                </button>
              </div>
            ))}
          <h3>確認結果</h3>
          <ul>
            {Object.entries(ITEM_LABELS).map(([item, label]) => (
              <li key={item}>
                {label}:{" "}
                {
                  VERDICT_LABELS[
                    state.evidence.find((entry) => entry.item === item)
                      ?.verdict ?? "unknown"
                  ]
                }
              </li>
            ))}
          </ul>
          {(["quality", "billing", "upstream_delete"] as const).map((item) => (
            <div className="media-probe-actions" key={item}>
              <span>{ITEM_LABELS[item]}</span>
              {(["pass", "fail", "unknown"] as const).map((verdict) => (
                <button
                  type="button"
                  key={verdict}
                  disabled={isBusy}
                  onClick={() =>
                    void perform(jobPath("report"), { item, verdict })
                  }
                >
                  {VERDICT_LABELS[verdict]}として報告
                </button>
              ))}
            </div>
          ))}
          <p className="app-hint">
            取消やアクセス拒否だけでは上流停止・未課金・全コピー消去を証明しません。自然期限の観測前に削除すると、その期限の実証はできません。
          </p>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void perform(jobPath("erase-body"))}
          >
            照合後に本文と取得先を消去
          </button>
        </section>
      )}
      {state && (
        <section className="resource-card">
          <h2>終了</h2>
          <p>
            停止後の照合期限{" "}
            {new Date(state.reconciliationUntil).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}{" "}
            JST
          </p>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void perform("/api/media-probe/close")}
          >
            回収・削除後に確認経路を閉鎖
          </button>
          <p className="app-hint">
            未確定の要求や削除待ちが残る場合は閉鎖できません。Cloudflare
            Accessの許可閉鎖・session失効・ログアウトは別の終了操作です。
          </p>
        </section>
      )}
    </main>
  );
}
