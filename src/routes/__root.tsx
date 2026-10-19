import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { THEME_INIT_SCRIPT, ThemeToggle } from "../components/theme-toggle";
import stylesheet from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: "Cloudflare AI Starter | 開発基盤" },
      {
        name: "description",
        content:
          "TanStack StartとCloudflare Workersで始める、再利用可能なAIアプリ開発基盤。",
      },
    ],
    links: [{ rel: "stylesheet", href: stylesheet }],
    scripts: [{ children: THEME_INIT_SCRIPT }],
  }),
  component: Root,
  notFoundComponent: () => (
    <main id="main" className="container section narrow">
      <p className="eyebrow">404</p>
      <h1>ページが見つかりません</h1>
      <Link className="button secondary" to="/">
        ホームへ戻る
      </Link>
    </main>
  ),
});

function Root() {
  return (
    // 初期化スクリプトがhydration前にdata-themeを付けるため、属性差分の警告を抑止する。
    <html lang="ja" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip-link" href="#main">
          本文へ移動
        </a>
        <header className="site-header">
          <div className="container header">
            <Link className="brand" to="/">
              <span className="brand-mark" aria-hidden="true">
                C
              </span>
              Cloudflare AI Starter
            </Link>
            <nav className="site-nav" aria-label="メインナビゲーション">
              <Link to="/help">はじめに</Link>
              <Link to="/app">AIチャット</Link>
              <Link to="/decisions">依頼の分類</Link>
              <Link to="/media">画像と素材</Link>
              <Link to="/media-probe">限定確認</Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <Outlet />
        <footer className="site-footer">
          <div className="container footer">
            <span>小さく始めて、必要な機能を育てる。</span>
            <span>TanStack Start · Cloudflare Workers</span>
          </div>
        </footer>
        <Scripts />
      </body>
    </html>
  );
}
