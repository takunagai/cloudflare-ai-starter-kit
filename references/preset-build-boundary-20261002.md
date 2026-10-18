# B-4の公開設定とCloudflare Vite build境界

確認日: 2026-10-02。公式ページの仕様と、インストール済み固定版の型/実装を照合した。依存更新やクラウド照会はしていない。

| 公式情報 | 確認した事実・採用・制約 |
| --- | --- |
| [Cloudflare environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/) | CLOUDFLARE_ENVはdev/buildで環境を選び、build後はflattenされた設定を使う。preview/deploy時の指定ではretargetしない。vars/bindingは環境ごとに明示する |
| [Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) | configPathを明示できる。pluginのconfig callbackで解決済み設定を検査する。remoteBindings既定trueに対し、合成試験は文書化されたforce-local指定で実接続を止める |
| [Programmatic configuration](https://developers.cloudflare.com/workers/vite-plugin/reference/programmatic-configuration/) | config callbackを利用し、設定本文の独自parser/任意パス受付を追加しない。Experimental newConfig等は採用しない |

固定版`@cloudflare/vite-plugin 1.60.2`の`dist/index.d.mts`/`index.mjs`とWrangler4.141.0の型/`config-schema.json`を確認。configPath優先、callbackへの解決済みWorker設定、targetEnvironment/definedEnvironments、EMAILのsend_email binding形状を照合した。最新公開文書だけで固定版の動作を推測せず、合成設定の実buildで検証する。

mode/envの固定対応、環境省略/不一致の拒否、APP_ENV/ポリシーの照合はこのアプリの契約であり、Cloudflare製品全体の制限ではない。build対象の一致と実運用の権限/保持/費用を分ける。実設定の閲覧/変更・実Access/メール/AI・配備は今回の対象外。

[設定メモ](../docs/公開プリセットとbuild境界.md)、[採用済み計画](../docs/用途別プリセット-開発計画.md)、[今回の検証結果](../docs/archive/B4完了-次セッション開始プロンプト.md)を参照。
