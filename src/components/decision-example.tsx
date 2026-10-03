import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  type Attempt,
  applyDecisionMetadata,
  type Classification,
  classificationFixtures,
  classifyOnce,
  type DecisionMetadata,
  type Intent,
  intentLabels,
  readDecisionMetadata,
  validDecisionInput,
  validDecisionKey,
} from "../lib/decision-example";
import { api } from "./api-client";

const stateLabels = {
  reserved: "受付済み・未送信",
  submitting: "送信処理中",
  succeeded: "成功・結果の再表示はできません",
  failed: "失敗・消費は返却されません",
  submission_unknown: "送信結果不明・消費と同時枠を保持",
};
function Result({
  result,
  fixture,
}: {
  result: Classification;
  fixture: boolean;
}) {
  return (
    <section
      className="resource-card"
      aria-label={fixture ? "合成fixtureの結果" : "APIの分類結果"}
    >
      <h3>{fixture ? "合成fixture・実Jev未使用" : "APIの分類結果"}</h3>
      <p>
        選択: <strong>{intentLabels[result.answer.choice]}</strong>
      </p>
      {result.answer.choice === "none" && (
        <p>候補外や材料不足、主目的を決められない場合の通常結果です。</p>
      )}
      <dl className="decision-values">
        {(Object.keys(intentLabels) as Intent[]).map((key) => (
          <div key={key}>
            <dt>{intentLabels[key]}</dt>
            <dd>{String(result.answer.probabilities[key])}</dd>
          </div>
        ))}
        <div>
          <dt>confidence</dt>
          <dd>{String(result.answer.confidence)}</dd>
        </div>
      </dl>
      <p className="app-hint">
        確率とconfidenceは応答値のまま表示しています。正しさを保証する値ではありません。必ず人が確認してください。自動採用や操作の承認には使いません。
      </p>
      <p className="app-hint">
        入力token {result.usage.inputTokens} / 出力token{" "}
        {result.usage.outputTokens}
        {fixture ? "（合成値・実測ではありません）" : "（検証済み応答のusage）"}
      </p>
    </section>
  );
}
function AttemptNotice({ attempt }: { attempt: Attempt }) {
  if (!attempt.code) return null;
  if (
    attempt.code === "decision_disabled" ||
    attempt.code === "decision_not_configured"
  ) {
    return (
      <p className="app-notice">
        未接続です。JevはOFF、または必要な設定がありません。合成fixtureへ代替しません。実接続の準備・承認は導入文書で別に行います。
      </p>
    );
  }
  if (attempt.disposition === "unresolved") {
    return (
      <p className="app-error">
        受付・送信・結果を確認できない、または処理中です。再送せず、この要求キーの状態だけを確認してください。不明なまま新しいキーで救済しません。中断や待機終了は上流停止・未課金の証拠ではありません。
      </p>
    );
  }
  if (attempt.code === "request_day_mismatch") {
    return (
      <p className="app-error">
        要求キーのUTC日がサーバーと一致しません。自動で日付やキーを差し替えません。時計を確認し、別の依頼を始める場合だけ明示操作してください。
      </p>
    );
  }
  return (
    <p className="app-error">
      分類は受け付けられないか、終了しました。結果は表示できません。設定・認証・入力・利用枠を導入文書で確認してください。自動再送は行いません。
    </p>
  );
}
export function DecisionExample() {
  const [fixtureIndex, setFixtureIndex] = useState(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [input, setInput] = useState("");
  const [consent, setConsent] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [statusKey, setStatusKey] = useState("");
  const [metadata, setMetadata] = useState<DecisionMetadata | null>(null);
  const [statusError, setStatusError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canCheckStatus, setCanCheckStatus] = useState(true);
  const inFlight = useRef(false);
  const nextStatusAt = useRef(0);
  const mounted = useRef(false);
  const fixture = classificationFixtures[fixtureIndex];
  useEffect(() => {
    mounted.current = true;
    api<{ identity: unknown }>("/api/session")
      .then((session) => {
        if (mounted.current) setAuthenticated(Boolean(session.identity));
      })
      .catch(() => {
        if (mounted.current) setAuthenticated(false);
      })
      .finally(() => {
        if (mounted.current) setSessionChecked(true);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (canCheckStatus) return;
    const timer = window.setTimeout(
      () => setCanCheckStatus(true),
      Math.max(0, nextStatusAt.current - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [canCheckStatus]);
  async function submit() {
    if (
      inFlight.current ||
      attempt ||
      !authenticated ||
      !consent ||
      !validDecisionInput(input)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    const key = `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`;
    setAttempt({ key, disposition: "unresolved" });
    setStatusKey(key);
    setMetadata(null);
    setStatusError("");
    try {
      const result = await classifyOnce(key, input);
      if (mounted.current) setAttempt(result);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function checkStatus() {
    if (
      inFlight.current ||
      !authenticated ||
      !validDecisionKey(statusKey) ||
      Date.now() < nextStatusAt.current
    )
      return;
    inFlight.current = true;
    nextStatusAt.current = Date.now() + 5000;
    setCanCheckStatus(false);
    setBusy(true);
    setMetadata(null);
    setStatusError("");
    const key = statusKey;
    try {
      const value = await readDecisionMetadata(key);
      if (!mounted.current) return;
      setMetadata(value);
      // A different key, failed GET, or not-found never unlocks an unresolved request.
      if (attempt?.key === value.requestKey) {
        setAttempt(
          (current) => current && applyDecisionMetadata(current, value),
        );
      }
    } catch {
      if (mounted.current)
        setStatusError(
          "状態を取得できません。未ログイン、別所有者、不存在、保持期限後、利用制限、通信障害等が考えられます。未送信とは断定せず、再送・枠解放は行いません。",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function startAnother() {
    if (inFlight.current || attempt?.disposition !== "terminal") return;
    if (
      !window.confirm(
        "別の依頼は新しい要求となり、再課金の可能性があります。表示中の入力・結果を消して別の依頼を始めますか？",
      )
    )
      return;
    setAttempt(null);
    setInput("");
    setConsent(false);
    setMetadata(null);
    setStatusKey("");
    setStatusError("");
  }
  return (
    <main id="main" className="container section help">
      <p className="eyebrow">TYPED DECISION</p>
      <h1>短い依頼の目的を分類する</h1>
      <p className="intro">
        技術相談・文章作成・計画整理・該当なしの4候補から、主目的を1つ表示する標準利用例です。チャットと独立し、分類の後に外部操作は行いません。
      </p>
      <section aria-labelledby="fixture-heading">
        <h2 id="fixture-heading">接続せずに表示を試す</h2>
        <p className="app-hint">
          以下は固定の合成fixtureです。入力から推論せず、外部通信・要求台帳への登録も行いません。実Jevの精度、confidence計算、日本語品質の証拠ではありません。
        </p>
        <div className="button-row">
          {classificationFixtures.map((item, index) => (
            <button
              key={item.label}
              type="button"
              className="secondary"
              aria-pressed={fixtureIndex === index}
              onClick={() => setFixtureIndex(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="plain-text">例の入力: {fixture.input}</p>
        <div aria-live="polite">
          <Result result={fixture.result} fixture />
        </div>
      </section>
      <section aria-labelledby="api-heading">
        <h2 id="api-heading">設定済みAPIへ明示的に依頼する</h2>
        <p className="app-hint">
          初期設定はJev
          OFF・キー不要です。この画面で接続を有効にすることはできません。実契約・保持・費用・権限・品質の確認と接続の別承認が必要です。
        </p>
        {!authenticated && (
          <p className="app-notice">
            {sessionChecked
              ? "APIの依頼と状態確認にはログインが必要です。"
              : "ログイン状態を確認中です。"}{" "}
            <Link className="text-link" to="/app">
              チャットのログイン画面へ
            </Link>
          </p>
        )}
        <p className="app-hint">
          入力・結果はこの画面のメモリだけで扱い、再読み込みや画面移動後は復元できません。機密・個人情報を入力しないでください。本文は接続が有効な場合に上流へ送信され、自動除去されません。
        </p>
        <form
          className="app-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="decision-input">
            分類する依頼文
            <textarea
              id="decision-input"
              rows={3}
              value={input}
              disabled={busy || Boolean(attempt)}
              onChange={(event) => setInput(event.target.value)}
              autoComplete="off"
            />
          </label>
          <p className="app-hint">
            1〜2,000 Unicode文字・UTF-8 8,000
            bytes以内。入力の自動修正や切り詰めはしません。
          </p>
          <div className="feature-toggles decision-consent">
            <label>
              <input
                type="checkbox"
                checked={consent}
                disabled={busy || Boolean(attempt)}
                onChange={(event) => setConsent(event.target.checked)}
              />
              本文の送信先・費用が承認済みで、1回の依頼として送る
            </label>
          </div>
          <button
            type="submit"
            disabled={
              !authenticated ||
              !consent ||
              !validDecisionInput(input) ||
              busy ||
              Boolean(attempt)
            }
          >
            {busy ? "処理中…" : "分類を1回依頼する"}
          </button>
        </form>
        <div aria-live="polite">
          {attempt && (
            <>
              <p className="app-hint">
                今回の要求キー（状態確認用。結果は保存しません）
              </p>
              <p className="plain-text">{attempt.key}</p>
              <AttemptNotice attempt={attempt} />
              {attempt.result && (
                <Result result={attempt.result} fixture={false} />
              )}
              <button
                type="button"
                className="secondary"
                disabled={busy || attempt.disposition !== "terminal"}
                onClick={startAnother}
              >
                別の依頼を始める（再課金の可能性）
              </button>
            </>
          )}
        </div>
      </section>
      <section aria-labelledby="status-heading">
        <h2 id="status-heading">本人の要求状態だけを確認する</h2>
        <p className="app-hint">
          応答を失ったときも再送しません。手動でGETし、成功後も結果は再表示できません。5秒以内の連続確認は抑止し、自動pollは行いません。unknownは消費と同時枠を保持し、別の依頼やキー変更で解除できません。
        </p>
        <form
          className="app-form"
          onSubmit={(event) => {
            event.preventDefault();
            void checkStatus();
          }}
        >
          <label htmlFor="decision-key">
            要求キー（UTC日付:UUIDv4）
            <input
              id="decision-key"
              value={statusKey}
              onChange={(event) => {
                setStatusKey(event.target.value);
                setMetadata(null);
                setStatusError("");
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            disabled={
              !authenticated ||
              !validDecisionKey(statusKey) ||
              busy ||
              !canCheckStatus
            }
          >
            状態だけ確認する
          </button>
        </form>
        <div aria-live="polite">
          {statusError && <p className="app-error">{statusError}</p>}
          {metadata && (
            <p className="app-notice">
              状態: {stateLabels[metadata.state]}
              。結果の取得・推論・再送・要求状態の更新は行っていません。
            </p>
          )}
        </div>
      </section>
      <p>
        <Link className="text-link" to="/app">
          チャットへ戻る →
        </Link>
      </p>
    </main>
  );
}
