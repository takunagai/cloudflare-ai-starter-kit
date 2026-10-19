import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "はじめに | Cloudflare AI Starter" }] }),
  component: Help,
});

function Help() {
  return (
    <main id="main" className="container section help">
      <p className="eyebrow">GETTING STARTED</p>
      <h1>小さく始めるための土台。</h1>
      <p className="intro">
        このスターターは、別のプロジェクトへ複製して使うAIアプリ開発基盤です。
      </p>
      <section className="help-section">
        <h2>いま確認できること</h2>
        <p>
          アカウントを作成し、モデルを選んで会話できます。会話は保存され、次回も続きから確認できます。初期設定ではAIを呼ばない固定応答で動作を試せます。
        </p>
      </section>
      <section className="help-section">
        <h2>用途に合わせて育てる</h2>
        <p>
          ログイン後の業務アプリ、公開コンテンツを持つサービス、長時間処理を行うエージェントに共通の基盤を使います。独立したサービスは、複製して別プロジェクトとして運用します。
        </p>
      </section>
      <section className="help-section">
        <h2>開発を続ける前に</h2>
        <p>
          起動や検証の手順は、プロジェクトのREADMEに記載しています。資料検索・承認付きメモ・長時間処理・画像生成・決済は、必要なものを有効にして使います。
        </p>
      </section>
      <div className="button-row help-actions">
        <Link className="button" to="/app">
          AIチャットを開く <span aria-hidden="true">→</span>
        </Link>
        <Link className="button secondary" to="/">
          ホームで接続を確認する
        </Link>
      </div>
    </main>
  );
}
