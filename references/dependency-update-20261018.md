# TanStack StartのXSS修正と直接依存の一括更新

確認日: 2026-10-18。`pnpm audit`でcritical 2件を検出したため、メジャー更新を除く直接依存をまとめて更新した。

## 1. 検出した脆弱性

| 対象 | 変更前 | 更新後 | 修正版 | 根拠 |
| --- | --- | --- | --- | --- |
| @tanstack/react-start | 1.168.58 | 1.169.3 | >=1.168.60 | [GHSA-qx66-fv34-fjm8](https://github.com/advisories/GHSA-qx66-fv34-fjm8)（CVE-2026-102989、2026-10-15公開） |
| @tanstack/start-server-core（推移） | 1.168系 | 1.169.44 | >=1.169.39 | 同上 |

内容: 未認証の攻撃者がserver functionへのURLを作り、開いた利用者の同一オリジンでスクリプトを実行させられる反射型XSS。server-function transportがpayloadを内部middleware状態へ渡すことが原因。

本リポジトリの`src`に`createServerFn`の利用はない（2026-10-18、0件）。ただしStartのserver-function入口が露出していたかは確認していないため、影響なしとは断定しない。同じ版を使う複製先は、それぞれのセッションで更新を確認する。

## 2. 更新した直接依存

dependencies: @ai-sdk/anthropic 4.0.82、@ai-sdk/google 4.0.99、@ai-sdk/openai 4.0.96、@ai-sdk/openai-compatible 3.0.71、@ai-sdk/provider 4.0.29、@tanstack/react-router 1.170.45、@tanstack/react-start 1.169.3、ai 7.0.143、better-auth 1.7.10、drizzle-orm 0.45.4、react/react-dom 19.3.1、zod 4.6.7。

devDependencies: @biomejs/biome 2.5.15、@tanstack/router-cli 1.167.45、@types/node 26.6.5、@vitejs/plugin-react 6.1.2、vite 8.3.4、@cloudflare/vite-plugin 1.64.0、@cloudflare/vitest-plugin 1.4.4、@cloudflare/workers-types 5.20261016.1、wrangler 4.151.1。

peerの確認（配布元のpeerDependencies）:

- @cloudflare/vite-plugin 1.64.0はwrangler ^4.151.0を要求するため、wranglerを同時に更新した。
- wrangler 4.151.1は@cloudflare/workers-types ^5.20261006.1を要求するため、5.20261016.1にした。
- @cloudflare/vitest-plugin 1.4.4のpeerはvitest ^4.1.0 || ^5.0.0。vitestは4.1.11のまま維持した。
- @tanstack/react-start 1.169.3のpeerはvite >=8.0.0、engines node >=22.12.0。better-authのpeerはreact-start ^1.0.0、drizzle-orm ^0.45.2。

ライセンスの変更は確認していない（react-startはMIT、wranglerはMIT OR Apache-2.0）。マイナー/パッチ更新のため、個別の変更履歴は精読していない。

## 3. 見送り

- vitest 5.0.5、@polar-sh/sdk 1.0.2: メジャー更新。破壊的変更の確認が必要なため別作業とする。
- `compatibility_date`（2026-09-25）: wrangler/workerdは更新したが、日付は動作変更の確認後に別作業で更新する。

## 4. overrideの整理

`pnpm-workspace.yaml`の版を指定したoverride 6件のうち、次の3件は対象版がlockfileから消え、効いていなかったため削除した。

- `miniflare@5.20260925.0-alpha>undici` / `>sharp`: miniflare 5.20261012系自体がundici 7.29.1、sharp 0.35.5を固定している。
- `postcss@8.5.28>source-map-js`: postcssが8.5.30になった。

残した3件: `@esbuild-kit/core-utils>esbuild`、`@ai-sdk/provider-utils@5.0.49>undici`、`@tailwindcss/node@4.3.3>source-map-js`。lockfile内のundici、sharp、source-map-jsは修正版（7.29.1、0.35.5、1.2.2）だけになった。

## 5. 検証（ローカル、2026-10-18）

- `pnpm install --frozen-lockfile`: 成功
- `pnpm audit`: 検出0件
- `pnpm check`: lint、typecheck、test（47ファイル929件、build fixture 7件）、build すべて成功
- `pnpm preview`と`pnpm smoke`: HTTP smokeとapp smokeが成功

GitHub CIと実環境への配備は未実施。
