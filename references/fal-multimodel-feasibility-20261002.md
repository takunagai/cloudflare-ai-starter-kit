# fal画像・動画の複数モデル対応: 実現性と概算

確認日: 2026-10-02。公開仕様と既存ソースの読み取りによる見積り。本人の最新指示でDirectorは除外・調査不要とし、初版は画像4/動画4/音声4の12 endpointと参照画像アップロードに確定した。最新の範囲・改訂見積りは[初版設計](../docs/fal-画像動画音声-初版設計.md)を正本とする。以下の一般案と旧見積りはモデル選定前の記録で、音声等を含む現在の見積りへ流用しない。コード変更・実生成・SDK導入・クラウド操作なし。

後続のM-0で[上限・保存・取得・回収・互換性の差分設計](../docs/fal-メディア-M0差分設計.md)と[詳細schema/保存関連の公式根拠](fal-media-contract-20261002.md)を追加した。参照画像7日/生成物30日/所有者1 GiBと、参照動画/音声・高度な音楽構成編集の初版除外は回答により採用。他の上限や上流公開条件は未決/未検証を維持する。

## 対象12 endpointの公式確認（後続指示）

対象12件の公式APIページを読み取り確認。URLの存在は実アカウントでの利用可能性・課金条件・Workers互換性の検証ではない。下記は確認した仕様の要約であり、範囲・実装案は初版設計で区別する。

| 指定endpoint・公式API | 確認した差分 |
| --- | --- |
| [openai/gpt-image-2.5/sunburst/text-to-image](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api) | queue、サイズ/品質/背景/枚数/PNG・JPEG・WebP、images配列。寸法は倍数/辺/面積/比率に制約 |
| [openai/gpt-image-2.5/sunburst/edit](https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api) | image_urls必須、最大16枚、任意mask_url。画像生成と共通の出力/品質設定 |
| [openai/gpt-image-2.5/flare/text-to-image](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api) | サイズ/背景/品質/枚数/形式。Sunburstと別endpointとして検証する |
| [openai/gpt-image-2.5/flare/edit](https://fal.ai/models/openai/gpt-image-2.5/flare/edit/api) | image_urlsと任意マスク。共通UIでもendpoint別契約を保持 |
| [minimax/h3-max/text-to-video](https://fal.ai/models/minimax/h3-max/text-to-video/api) | queue、prompt、秒数、480P/768P/1080P等。video応答 |
| [minimax/h3-max/image-to-video](https://fal.ai/models/minimax/h3-max/image-to-video/api) | image_url/end_image_url。両方省略するとテキストから生成になる仕様。アプリでは明示した操作と入力を対応させる |
| [minimax/h3-max/reference-to-video](https://fal.ai/models/minimax/h3-max/reference-to-video/api) | 画像/動画/音声の参照配列、合計最大12素材。配列順で参照。始終画像も指定可能。初版は参照画像を優先する案 |
| [minimax/h3-max/camera-controls](https://fal.ai/models/minimax/h3-max/camera-controls/api) | image_url必須、camera_trajectoryの時刻/方位/仰角/距離。queueの動画結果。単純なカメラ名選択だけでは全契約を表せない |
| [google/gemini-3.8-flash-tts](https://fal.ai/models/google/gemini-3.8-flash-tts/api) | 本文/演技指示、既定音声、単一話者または2話者の台本。WAVのaudio応答。合計入力8192 token上限を記載 |
| [google/gemini-3.8-flash-lite-tts](https://fal.ai/models/google/gemini-3.8-flash-lite-tts/api) | 同じ主要TTS契約、別endpoint。音声選択と台本の排他入力を検証 |
| [elevenlabs/tts/eleven-v4](https://fal.ai/models/elevenlabs/tts/eleven-v4/api) | text、voice、安定性/類似度、言語、形式、時刻情報。queueとstreamingの案内がある。初版はqueueの完成音声を扱う案 |
| [elevenlabs/music/v2.5](https://fal.ai/models/elevenlabs/music/v2.5/api) | promptまたはcomposition_plan。prompt方式は長さ/インスト指定、composition方式はchunk構成とseed。3〜600秒の仕様上限はアプリの許可上限ではない |

注意: Gemini TTSやH3の例に音声/動画と整合しないimage/pngや空URLが含まれる。サンプルJSONを有効な生成結果として採用せず、schemaの意味と本物の出力は実装/別承認の実接続で照合する。新モデルの単価・利用条件は未確認。

## 公式仕様と現行実装

| 根拠 | 確認した事実と設計上の意味 |
| --- | --- |
| [FLUX schnell](https://fal.ai/models/fal-ai/flux/schnell/api) | 縦横比や幅/高さ、枚数等の入力がある。現在の正方形/PNG1枚制限はこのスターターのサンプル仕様であり、fal全体の制約ではない |
| [Nano Banana](https://fal.ai/models/fal-ai/nano-banana/api) | aspect_ratio、num_images、output_format等を持つ。FLUXのimage_sizeを全モデルへ一律送信できない |
| [Veo 3.1 Fast](https://fal.ai/models/fal-ai/veo3.1/fast/api) | 動画用の秒数・解像度・音声設定とvideo応答がある。紹介文とschemaで対応値の記述差があるため、採用時には組合せ制約も再確認する。自動プロンプト修正等の既定値も明示的に扱う |
| [Ovi](https://fal.ai/models/fal-ai/ovi/api) | 動画でも解像度や音声用入力等の形が異なる。全動画モデル共通の入力schemaだけでは扱えない |
| [Queue](https://fal.ai/docs/documentation/model-apis/inference/queue) | 受付・状態・結果・取消の共通経路を利用可能。結果はモデル固有。取消要求は実行停止を保証しない。media URLの公開/期限は設定・CDN種別に依存し、全件が非公開/有限期限とは仮定しない。M-0追加調査を参照 |

上記モデルは仕様差を調べる例であり、採用・商用条件・価格・実接続互換性を確定した一覧ではない。

現行の`src/server/extensions/images.ts`は入力、queue URL検証、送信パラメータ、画像1件の応答処理がFLUX専用。`src/components/extensions-panel.tsx`もモデル固定・画像表示専用。`migrations/0003_extensions.sql`のimage_jobsと既存テストには所有権・枠予約・重複防止・受付不明・取消競合の土台がある。この処理は再利用候補だが、動画対応済みとは扱わない。

## 推奨する構造（未採用）

サーバーに小さなモデル登録表を置き、モデルID、画像/動画と入力種別、入力検証、対応設定、固定endpoint、結果変換、上限を定義する。導入者は登録済みモデルのうち環境で許可するものを選び、利用者はその一覧から選択する。新モデルは定義と必要なadapter・テストを追加する。単一パッケージ/主Workerを維持し、汎用プラグイン基盤は作らない。

UIは共通のプロンプト/モデル選択に加え、そのモデルで使える縦横比・解像度・枚数・秒数・音声等だけを表示する。詳細設定もサーバーで検証し、未登録モデルや任意endpoint/JSONの無条件転送は認めない。モデルの無効化後も既存ジョブの状態取得/取消を可能にする設計を分ける。

画像/動画の結果型、モデルと設定の保存、既存ジョブ互換を設計し、必要なら新migrationを追加する。過去SQLは変更しない。動画は長時間待機/再読み込み復帰/再生と、秒数・解像度等に応じた受付上限が必要。失敗時の自動再生成はしない。見積金額を確定請求や硬い予算上限と扱わない。

## 実装負荷の概算

経験者1名、1人日6〜8時間相当の作業量。AI支援による短縮は見込まず、現行コードの改修・レビュー・workerd/fake検証・UI確認・手順更新を含む。実モデル品質/料金の検証、配備、承認待ち、Jevやプリセット本体の工数は別。モデル選定前の概算で、特殊な入出力やAPI差異で増える。

| 範囲 | 現行からの累計目安 |
| --- | --- |
| 画像3〜5モデル、選択UI、対応する縦横比/解像度/枚数/形式、上限/テスト | 2〜4人日 |
| 上記＋テキストから動画2〜3モデル、秒数/解像度/音声、履歴・再生・待機管理 | 5〜9人日 |
| 上記＋参照画像アップロード、画像編集/画像から動画、非公開保存・認証配信・削除の基本経路 | 8〜14人日 |

初版は画像3〜5・動画2〜3モデルを選ぶ中段を推奨。参照画像が主用途なら下段を初版範囲とする。サーバー側の素材回収・非公開保存を含まない中段では、falの公開期限付きURLの制約が残る。大規模バッチ・編集タイムライン・動画連結・全モデル自動登録・完全自動フォーム・常時更新価格表示は見積り対象外。

登録方式完成後の追加1モデルは、既存と同じ入力/出力系なら0.5〜1人日、新しい素材入力/出力/独自設定が必要なら1〜3人日以上の目安。単なるモデル名追記だけで全モデルが使えるとは保証しない。

## 検証と次の判断

ローカルではモデル別の入力/出力、未許可モデル拒否、外部呼出し先検証、枠予約・所有権・二重送信、受付不明、取消競合、timeout、旧画像ジョブ互換、UIの設定切替/再読み込み/動画表示をfake外部境界で検証する。工程Bの通常staging・許可モデル境界と接続し、旧検証stagingでは引き続き遮断する。

モデル選定前には初回モデル群と参照入力も未決だったが、現在は12件と参照画像に確定した。残るのはM-0の推奨数値・取得構成・上流保存/公開条件等。Jevの標準採用をfal機能の標準化へ自動適用しない。実生成は対象モデル・入力・回数・料金・終了方法の別承認後に限定して確認する。
