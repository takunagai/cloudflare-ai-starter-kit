# M-1共通メディアジョブの公式確認

確認日: 2026-10-04。公式公開文書の読み取りのみ。実fal/Cloudflareアカウント照会・課金・Secret操作は行っていない。アプリの採用値は[M-0契約](../docs/fal-メディア-M0差分設計.md)を正本とする。

| 根拠 | M-1への反映・限界 |
| --- | --- |
| [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) | batchは順次実行のtransactionで、失敗時は全体がrollbackする。原子的な受付・利用/容量予約と本文/参照の登録に使う。隔離したローカルD1でDDLを含む失敗を確認する |
| [Vite persistState](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) / [ローカルデータ](https://developers.cloudflare.com/workers/local-development/local-data/) / [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) | ViteのpersistStateとWranglerのlocal persist-toを同じ専用パスへ向け、元利用DBから隔離する。固定Wrangler4.141.0のhelpでもlocal/persist-toを照合。最終版の空DBへ8本適用し、再適用0を確認する |
| [fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue) | 受付・状態・結果・取消を分離する。取消受付を停止確定と扱わない。モデルIDと保存済みrequest IDから経路を構成し、provider返却URLを命令にしない。実adapterの結線と到達性は後続 |
| [Sunburst生成](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api) / [編集](https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api) / [Flare生成](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api) / [編集](https://fal.ai/models/openai/gpt-image-2.5/flare/edit/api) | 4件を別IDとして登録。アプリは品質・形式・背景・寸法・枚数・参照/マスクを厳密な入力に限定。上流への変換・検査済みファイル回収はM-2 |
| [H3テキスト](https://fal.ai/models/minimax/h3-max/text-to-video/api) / [始終画像](https://fal.ai/models/minimax/h3-max/image-to-video/api) / [参照画像](https://fal.ai/models/minimax/h3-max/reference-to-video/api) / [カメラ](https://fal.ai/models/minimax/h3-max/camera-controls/api) | 4件を区別し、採用済み5/10秒と素材role・参照順序・正規化キーフレームを受付契約にする。上流の幅広いdurationを自動開放しない。動画adapter/再生・実生成はM-3/E |
| [Gemini Flash](https://fal.ai/models/google/gemini-3.8-flash-tts/api) / [Flash Lite](https://fal.ai/models/google/gemini-3.8-flash-lite-tts/api) | 公式30音声・単一/2話者の排他を登録。アプリのUTF-8 bytes上限と上流8192 tokenの検査は別。token計数と音声adapterはM-4 |
| [Eleven v4](https://fal.ai/models/elevenlabs/tts/eleven-v4/api) / [Music v2.5](https://fal.ai/models/elevenlabs/music/v2.5/api) | 固定音声候補/MP3、長さ指定のprompt方式を受付契約にする。音声の実利用権限・ミリ秒変換/回収はM-4/E。composition方式や任意音声を開放しない |

公開ページの入力schemaとアプリ独自の受付上限を区別する。本文の読取りは12件の実利用可否・保存ACL/保持・実品質・費用の検証ではない。検証用driverの成功を実adapterの提供や実接続の許可にしない。
