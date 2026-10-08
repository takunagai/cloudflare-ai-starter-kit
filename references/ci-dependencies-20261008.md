# CIで検出する推移依存の脆弱性修正とCIシェルの修正

確認日: 2026-10-08。2026-10-08のmain push（`da1353f`、`86bef95`）でGitHub CIが失敗した。原因は2件で、いずれも複製先private-rag-chatが先に同じ修正を適用しCI成功を確認済み（同リポジトリ`cb28ff3`、`fe896f0`）。本書はスターターへの逆輸入の根拠。

## 1. 合成build試験のシェル

`tests/build-fixtures.test.mjs`は子プロセスを`/bin/zsh -f -c`で起動していた。GitHubのubuntu runnerにはzshがなく、buildが固定拒否コードを出す前に起動自体が失敗するため「expected fixed rejection code」で停止した。`/bin/sh -c`へ変更した。macOSとubuntuの両方で`/bin/sh`は存在する。

## 2. 推移依存の脆弱性（`pnpm audit` high 2件）

| 対象 | 変更前 | 修正版 | 配布元の要件・ライセンス | 根拠 |
| --- | --- | --- | --- | --- |
| source-map-js | 1.2.1 | 1.2.2 | Node >=0.10.0、peerなし、BSD-3-Clause | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)、[公式release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) |
| sharp | 0.35.4 | 0.35.5 | Node >=20.9.0、peerなし、Apache-2.0 | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[公式release](https://github.com/lovell/sharp/releases/tag/v0.35.5) |

`pnpm why`ではsource-map-jsはPostCSS/Tailwind、sharpはMiniflareからの推移依存。Miniflareはsharp 0.35.4をexactで要求するため範囲内更新では進まない。[pnpmのoverride仕様](https://pnpm.io/settings/dependency-resolution#overrides)に従い、`pnpm-workspace.yaml`へ親と子を指定する3条件だけを追加し、`pnpm-lock.yaml`をpnpm 12.6.0で再生成した。直接依存、Node/pnpm版、既存overrideは変更していない。無視設定や検査基準の緩和は使わない。

更新後の`pnpm install --frozen-lockfile`と`pnpm audit`（検出0件）、`pnpm check`、ローカルpreviewのHTTP smokeの結果は[current-state.md](../docs/current-state.md)の該当行に記録する。実アプリへの攻撃成立や既存データへの影響をaudit結果だけで断定しない。親パッケージが修正版以降を採用したら、直接依存の更新時にoverrideの除去を再評価する。

## 3. 付随のテスト整理

`tests/media-image-inspection.test.ts`の4096px PNG fixtureを`beforeAll`で1回だけ生成する。検査時間と圧縮時間を分けるだけで、受付・拒否条件は変えない。
