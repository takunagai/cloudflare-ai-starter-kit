import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Cloudflare AI Starter | 開発基盤" },
      {
        name: "description",
        content:
          "TanStack StartとCloudflare Workersで始める、再利用可能なAIアプリ開発基盤。",
      },
    ],
    links: [{ rel: "stylesheet", href: stylesheet }],
  }),
  component: Root,
  notFoundComponent: () => (
    <main className="container section">
      <h1>ページが見つかりません</h1>
      <Link to="/">ホームへ戻る</Link>
    </main>
  ),
});

function Root() {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip-link" href="#main">
          本文へ移動
        </a>
        <header className="container header">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true">
              C
            </span>
            Cloudflare AI Starter
          </Link>
          <nav aria-label="メインナビゲーション">
            <Link to="/" activeOptions={{ exact: true }}>
              ホーム
            </Link>
            <Link to="/help">はじめに</Link>
            <Link to="/decisions">依頼の分類</Link>
            <Link to="/media">画像と素材</Link>
          </nav>
        </header>
        <Outlet />
        <footer className="container footer">
          <span>小さく始めて、必要な機能を育てる。</span>
          <span>TanStack Start · Cloudflare Workers</span>
        </footer>
        <Scripts />
      </body>
    </html>
  );
}
