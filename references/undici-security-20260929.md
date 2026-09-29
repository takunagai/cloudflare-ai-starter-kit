# undiciの限定したセキュリティ更新

確認日: 2026-09-29（JST）。実AI検証を終了した後の文書commit `060bb0c8df7238b86e207ae918de64879bdec038`で、[push CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36498237549)と[pull_request CI](https://github.com/takunagai/cloudflare-ai-starter-kit/actions/runs/36498237762)がauditで失敗した。push側のcheck・local migration・HTTP smokeは成功しており、監査ではGHSA-3wwx-pv8p-q78vの1件が報告された。実AI結果の失敗ではない。

## 公式根拠と採用判断

- [undici公式アドバイザリ](https://github.com/nodejs/undici/security/advisories/GHSA-3wwx-pv8p-q78v): 7系の影響範囲は7.28.0以上7.29.1未満。圧縮されたWebSocket入力の処理で未処理エラーが生じ、Nodeプロセスが終了する問題。修正版7.29.1を採用する。
- [7.29.1の公式リリース](https://github.com/nodejs/undici/releases/tag/v7.29.1): 当該修正と関連するセキュリティ修正・HTTP処理変更を確認した。メジャー更新は行わない。
- [npm配布メタデータ](https://registry.npmjs.org/undici/7.29.1): `pnpm view undici@7.29.1 version engines peerDependencies license --json`でversion 7.29.1、Node >=20.18.1、MIT、peerDependenciesの宣言なしを確認した。プロジェクトのNode 26.10.0は要件を満たす。

既存依存元は`@ai-sdk/provider-utils@5.0.49`（^7.29.0）と`miniflare@5.20260925.0-alpha`（7.29.0固定）。`pnpm-workspace.yaml`でこの2つだけを7.29.1へoverrideし、lockfileを再生成した。他の直接依存・Node/pnpm・Cloudflare設定・監査方針は変更しない。固定親版を更新するときは、上流が修正版を要求するかを確認し、不要になったoverrideを除去する。

## 検証と適用範囲

固定lockfileのinstallと公開npm監査を実施し、auditの既知脆弱性報告は0件。checkとローカルHTTP smokeの結果は[運用記録](../docs/operations.md#依存更新と監査)へ保存する。実AIを検証した配備ソースは`7abc1696980c8d88e05452ad1ae370558a920553`であり、この依存更新を実配備・実AIで検証したとは扱わない。現在のstagingはAI OFFで、追加配備・推論は行わない。

Node本体に組み込まれるundiciはnpm依存のoverrideでは更新されない。今回の監査解消を、Node本体・すべての依存・全接続経路の安全性保証へ広げない。
