# 2026-11-04の依存監査対応（zod・undici・seroval）

確認日: 2026-11-04。CIの`pnpm audit`が14件（high 8、moderate 6）で失敗した。原因は新しく公開された勧告で、アプリのコード変更ではない。

## 検出と対応

| パッケージ | 旧版 → 新版 | 勧告 | 経路 | 解決方法 |
| --- | --- | --- | --- | --- |
| zod | 4.6.5 → 4.6.6 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | `@cloudflare/vitest-plugin`だけ（アプリ本体のzodは4.6.7で対象外） | 親パッケージ`@cloudflare/vitest-plugin`を1.4.4から1.5.1へ。1.5.1はzod 4.6.6を固定している |
| undici | 7.29.1 → 7.30.1 | GHSA-4qv8-2p9j-2685、GHSA-f72v-6w45-q472、GHSA-xjj6-f33q-929c、GHSA-4w7w-5xrc-9h26、GHSA-2m5v-pch6-74hx、GHSA-qrxm-fqhp-jwvm、GHSA-9fm3-97px-rjf6、GHSA-55wc-3pg8-jfw6 | miniflare（wrangler・Cloudflare Vite/Vitest plugin経由）と`@ai-sdk/provider-utils` | miniflareは固定版のため、親パッケージを更新した（wrangler 4.157.0、`@cloudflare/vite-plugin` 1.67.0、`@cloudflare/vitest-plugin` 1.5.1。どれもundici 7.30.1を固定したminiflareを使う）。provider-utilsの宣言範囲は`^7.29.0`なので、lockfile内で再解決した |
| seroval / seroval-plugins | 1.6.7 → 1.7.7 | GHSA-f86p-h4j2-7qgj、GHSA-9wx9-5pv9-3349、GHSA-97r2-qh9m-474h、GHSA-wp97-x4hv-qvhp、GHSA-7rv5-mrxv-xcr9 | `@tanstack/router-core`（TanStack Start・Router経由） | 宣言範囲`^1.6.7`の中でlockfileを再解決した。1.7.0のリリースノートに従い、seroval-pluginsも同じ版にそろえた |

wrangler 4.157.0のpeer（`@cloudflare/workers-types ^5.20261103.1`）を満たすため、`@cloudflare/workers-types`を5.20261016.1から5.20261103.1にした。

overridesは使っていない。親パッケージの更新か範囲内の再解決で修正版に届くので、固定を増やす理由がない。効いていなかった`@ai-sdk/provider-utils@5.0.49>undici`のoverrideは削除した（lockfileのprovider-utilsは5.0.62）。範囲内の再解決は、下限を宣言で保証しない。lockfileを作り直したときは`pnpm audit`で確かめる。

## 本番で読み込まれる経路

build成果物（`dist/server`のsource map）にどのパッケージが含まれるかで判定した。

- zod 4.6.5: 開発時だけ（Vitest plugin）。本番Workerに入るzodは4.6.7。
- undici: 本番Workerに入らない。server source mapにundiciのソースは無い。miniflareとwranglerは開発・テスト・previewの実行環境。provider-utils経由のundiciもWorkers向けのbuildには含まれていない（bundleにあるのは文字列の参照だけ）。
- seroval・seroval-plugins 1.7.7: 本番で使う。TanStack Startのserver bundleに入り、client bundleにも入る（SSRのデータ受け渡し）。

## 変更履歴の確認

| 対象 | 確認先 | 結論 |
| --- | --- | --- |
| wrangler 4.152〜4.157 | [CHANGELOG](https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/CHANGELOG.md) | 破壊的変更・engines・peerの引き上げなし。4.154.0でMiniflareのdev registryが既定で有効になった。複数Workerを別プロセスで同時にdevするときだけ関係する |
| `@cloudflare/vite-plugin` 1.65〜1.67 | workers-sdkの`@cloudflare/vite-plugin@1.67.0`タグのCHANGELOG | 1.65.0で`experimental.newConfig`を削除。1.66.0でdev registryのパスが変わり、`MINIFLARE_REGISTRY_PATH`を読まなくなった。1.67.0は不正な`.assetsignore`でbuildが失敗する。本リポジトリはどれも使っていない（grepで0件） |
| `@cloudflare/vitest-plugin` 1.4.5〜1.5.1 | workers-sdkの`packages/vitest-plugin/CHANGELOG.md` | 1.5.0で`experimental.newConfig`を`config`へ昇格。関数形式の`cloudflareTest`は変わらない。peerは`vitest ^4.1.0 \|\| ^5.0.0`で、vitest 5.0.5のままでよい |
| seroval 1.7.0〜1.7.7 | [Releases](https://github.com/lxsmnsyc/seroval/releases) | engines `>=20`。1.7.1で、streamを含む値を同期の`serialize`系に渡すと例外を投げるようになった。`src`はserovalを直接importしていない。TanStack Start経由の挙動はtestとsmokeで確認した |
| undici 7.30.0〜7.30.1 | [Releases](https://github.com/nodejs/undici/releases) | 破壊的変更なし。7.30.1はセキュリティ修正 |

同梱workerdは1.20261012.1から、1.20261101.1（`@cloudflare/vite-plugin`のminiflare）と1.20261103.1（wrangler・Vitest pluginのminiflare）の2版になった。miniflareの新しい依存として`ws` 8.22.0が加わった。どちらも開発・テスト用の実行環境で、本番bundleには入らない。

ライセンスは変わっていない（MIT、wranglerはMIT OR Apache-2.0）。`compatibility_date`は変更していない。

## 検証（ローカル）

`pnpm install --frozen-lockfile`、`pnpm check`（lint・typecheck・test 850件＋build fixture 8件・build）、`pnpm db:migrate:local`、build済みpreviewの`pnpm smoke`、`pnpm audit`（検出なし）がすべて成功した。GitHub CIの結果はPRで別に確認する。
