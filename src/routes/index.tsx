import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { healthSchema } from "../lib/contracts";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  async function checkConnection() {
    setState("loading");
    try {
      const response = await fetch("/api/health", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("接続失敗");
      healthSchema.parse(await response.json());
      setState("ok");
    } catch {
      setState("error");
    }
  }
  const statusText =
    state === "ok"
      ? "接続できました。Workerが正常に応答しています。"
      : state === "error"
        ? "接続できませんでした。開発サーバーを確認して再試行してください。"
        : state === "loading"
          ? "接続を確認しています…"
          : "まだ接続を確認していません。";
  return (
    <main id="main" className="container">
      <section className="hero">
        <p className="eyebrow">YOUR NEXT PROJECT STARTS HERE</p>
        <h1>
          次のアプリを、
          <br />
          ここから。
        </h1>
        <p className="intro">
          公開ページも、毎日の業務を助けるAIも。
          <br className="desktop-break" />
          ひとつの基盤から、必要な形へ育てていけます。
        </p>
        <div className="button-row">
          <Link className="button" to="/app">
            AIチャットを開く <span aria-hidden="true">→</span>
          </Link>
          <Link className="button secondary" to="/help">
            このスターターについて
          </Link>
        </div>
      </section>
      <section className="setup-card" aria-labelledby="setup-title">
        <div>
          <p className="eyebrow">STEP 01 / FOUNDATION</p>
          <h2 id="setup-title">開発環境の接続確認</h2>
          <p>ボタンを押して、画面からWorkerへの通信を確認します。</p>
          <p
            className="status"
            data-state={state}
            role="status"
            aria-live="polite"
          >
            {statusText}
          </p>
        </div>
        <button
          type="button"
          onClick={checkConnection}
          disabled={state === "loading"}
        >
          {state === "loading" ? "確認中…" : "接続を確認する"}
        </button>
      </section>
      <section className="section" aria-labelledby="next-title">
        <div className="section-heading">
          <h2 id="next-title">ここから始められること</h2>
          <span className="badge">必要な機能を選んで使う</span>
        </div>
        <div className="feature-grid">
          <article className="feature-card">
            <span className="number">01</span>
            <h3>AIとの対話</h3>
            <p>
              モデルを選び、会話を続ける。履歴を保存して、次の作業へつなげます。
            </p>
          </article>
          <article className="feature-card">
            <span className="number">02</span>
            <h3>用途に合うログイン</h3>
            <p>
              公開サービスと、社内・個人のツール。それぞれに合う認証を選べます。
            </p>
          </article>
          <article className="feature-card">
            <span className="number">03</span>
            <h3>必要な分だけ拡張</h3>
            <p>
              資料検索、エージェント、長時間処理、決済を用途に合わせて追加します。
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
