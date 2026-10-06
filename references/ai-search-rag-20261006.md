# AI Searchを使う非公開RAGの公式照合（2026-10-06）

結論: 既存スターターの「非公開R2原本→AI Searchのinstance binding→所有者filter→D1/R2再照合→出典付き回答」は、当日の公開API形と整合する。ただし実インスタンスの索引・custom metadata・所有者分離・検索品質は未検証であり、実資料の読取/送信、クラウド作成、生成の有効化は行っていない。共通スターター本体に個別アプリの資料・設定を混ぜない。

| 一次資料 | 確認した内容 | 採否・制約 |
| --- | --- | --- |
| [AI Searchの2026-10-01更新](https://developers.cloudflare.com/ai-search/platform/release-note/#2026-10-01) | AI SearchはGAとなり、新規instanceはhybrid検索が既定。以前のOpen Betaという記録は当時の状態 | 利用可否をBeta前提で説明しない。既存の実索引未検証を成功へ格上げしない |
| [Workers instance binding](https://developers.cloudflare.com/ai-search/api/search/workers-binding/) | `ai_search`の単一instance binding、`search({query,ai_search_options})`、返却`chunks[].item.key/metadata`を掲載 | 既存のAPI入力/返却形は公開仕様と整合。実indexでのmetadata反映と型/権限は別に確認する。開発時の`remote:true`を無断追加しない |
| [filtering](https://developers.cloudflare.com/ai-search/configuration/retrieval/filtering/) | `$eq`と複数条件の暗黙AND、filterable文字列の先頭64 UTF-8 bytesを説明 | 既存の所有者hash64文字と直下folderのAND条件を維持。filterを外すfallbackはしない。実索引で2利用者のダミー資料を使い分離を確認する |
| [R2データソース/metadata](https://developers.cloudflare.com/ai-search/configuration/data-source/r2/) | 非公開R2をデータソースにできる。objectのcustom metadataを索引する前にschemaが必要 | `owner_key`/`document_id`のtext schema、非公開bucket、D1/R2での再認可を維持。built-in storageへの無断切替はしない |
| [limits/pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/) | AI Searchの従量課金開始予定は2026-11-01。月次包含量はingestion 500万token、storage 10 GB-month、semantic/full-text各1,000 query。超過単価とOCR加算を掲載 | 10月6日時点の公開表であり、個別アカウントの残枠・将来料金・硬い上限を保証しない。回答生成モデルとCloudflare基盤の費用は別に扱う |

現行サンプルの登録入力はタイトルとMarkdown/プレーンテキスト本文で、1件50,000文字・HTTP本文200,000 bytes・所有者あたり未削除100件まで。PDF/Word抽出、OCR、任意URLクロールはアプリ側に未実装。[既存のRAG手順と制約](../docs/extensions.md)を参照。AI Search側がPDF/OCRを扱えても、アプリが手元のファイルを安全に取り込めることの証拠にはならない。最初の資料形式と外部保存/モデル送信範囲は別に確定する。
