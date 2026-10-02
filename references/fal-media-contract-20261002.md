# fal M-0: 入力境界・保存・取得の公式根拠

確認日: 2026-10-02。公式公開ページの読み取りのみ。12 endpointのAPI文書を再確認し、H3の4件とSunburst text-to-imageはリンクされた詳細OpenAPIも確認した。実生成・価格・アカウント権限・クラウド操作は未実施。採否とアプリ独自の推奨値は[M-0差分設計](../docs/fal-メディア-M0差分設計.md)へ分ける。

## endpoint別の確認

| 公開根拠 | 確認した契約と注意 |
| --- | --- |
| [Sunburst text-to-image](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api) / [詳細schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=openai%2Fgpt-image-2.5%2Fsunburst%2Ftext-to-image) | 明示寸法は16の倍数、辺3840以下、比率3:1以内、面積655,360〜8,294,400。品質6種、PNG/JPEG/WebP、num_imagesはschemaでは1〜10。共通ImageSize型の広い範囲だけでモデル制約を代用しない |
| [Sunburst edit](https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api) | image_urls最大16、任意mask_url、既定サイズauto。参照順序とmask対象をアプリで固定する |
| [Flare text-to-image](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api) / [Flare edit](https://fal.ai/models/openai/gpt-image-2.5/flare/edit/api) | サイズ・品質・背景・出力形式/圧縮の契約、editの複数画像/マスクを確認。別endpointとしてfixture/未知入力拒否を用意し、一方の実接続成功を共有しない |
| [H3 text-to-video](https://fal.ai/models/minimax/h3-max/text-to-video/api) / [詳細schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Ftext-to-video) | durationは5〜15の整数、既定5。480P/768P/1080P、6縦横比。prompt_expansion_mode、safety checker、target_audio_urlがある。初版は音声入力を拒否 |
| [H3 image-to-video](https://fal.ai/models/minimax/h3-max/image-to-video/api) / [詳細schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Fimage-to-video) | duration5〜15、開始/終了画像はいずれか一方でも可。両方省略するとテキスト生成へ切替。アプリでは画像不足として拒否する |
| [H3 reference-to-video](https://fal.ai/models/minimax/h3-max/reference-to-video/api) / [詳細schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Freference-to-video) | duration5〜15、参照画像最大9、参照動画/音声各最大3、全参照合計12。別に始終画像欄がある。初版は参照画像だけ |
| [H3 camera-controls](https://fal.ai/models/minimax/h3-max/camera-controls/api) / [詳細schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Fcamera-controls) | duration3〜15、camera_trajectoryは2〜12キー。timeは0〜1、elevationは−90〜90、distanceは正数、azimuthは符号付き回転を保持し総移動32回転以内。終端以降は最終姿勢を維持 |
| [Gemini Flash TTS](https://fal.ai/models/google/gemini-3.8-flash-tts/api) / [Flash Lite TTS](https://fal.ai/models/google/gemini-3.8-flash-lite-tts/api) | 単一本文/音声と2話者/台本、演技指示、30音声、WAV出力、入力合計8192 token。文字/bytes上限だけでtoken検証済みとしない |
| [Eleven v4](https://fal.ai/models/elevenlabs/tts/eleven-v4/api) | voice、language_code、stability、similarity_boost、seed、output_format等。アプリで公開音声/MP3の許可リストを絞る案。音声ごとの実利用可否は未検証 |
| [Eleven Music v2.5](https://fal.ai/models/elevenlabs/music/v2.5/api) | prompt方式とcomposition_plan方式。長さ3,000〜600,000ms、seedはcomposition_plan専用。初版prompt方式でseedを共通表示しない |
| [OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation) | maskは先頭参照に適用、画像と同じ寸法/形式、alpha等の条件。fal wrapperへの適用は未検証であり、PNG同士の保守的なアプリ制限を提案 |

APIページの説明とschemaの機械制約が分かれるため、M-1以降で登録表を作る際は両方の交差を採る。対象外パラメータを自動公開するschema駆動の汎用フォームは作らない。H3/Geminiの応答例に空URLやmedia種別と異なるMIMEがあり、例をそのまま正常fixtureにしない。

## queue・fal側保存

| 根拠 | 事実 | 設計判断・未検証 |
| --- | --- | --- |
| [Queue](https://fal.ai/docs/documentation/model-apis/inference/queue) | submit/status/result/cancelを分離。取消は既に開始した処理の停止を保証しない | request IDを保存し、受付不明時は生成を再送しない。モデルごとのqueue経路を固定し、返却URLの無条件利用をしない |
| [Platform headers](https://fal.ai/docs/documentation/model-apis/common-parameters) | Request-Timeoutは開始までの期限。No-Retryで再試行を無効化、disable-fallbackで代替endpointを止める。Store-IO=0はJSON保持を抑えるがCDN削除ではない。Lifecycleの未設定はアカウント設定に従う | 明示headerを提案。JSONを保持しない設定と非同期result再取得の両立は未検証。未設定なら全結果が一定期間で消えるとは仮定しない |
| [Data retention](https://fal.ai/docs/documentation/model-apis/media-expiration) | expiration_duration_secondsでCDN期限を指定、nullは無期限。削除APIは完了した要求が対象で、入力CDNファイルの削除とは別 | R2保存期限・fal CDN・入力コピー・DB/バックアップの保持を分ける。Eで実際の保持/削除条件を確認 |
| [File access controls](https://fal.ai/docs/documentation/model-apis/file-access-controls) | ACLはfal CDN v3限定。出力用headerは別途uploadした入力のACLに及ばない。制限ファイルの取得にはFAL_KEYから交換したBearer tokenが必要。短いexpiration_secondsを指定可能 | private出力とサーバー回収を推奨。12件への適用・匿名取得拒否・別CDN応答の有無は未検証。アプリはfal.storageへ素材を直接uploadしない |

モデルページの「Commercial use」表示だけで用途固有の権利・アカウント利用権限・価格を確定しない。初版で採らない高度な入力の仕様は、入力拒否の根拠に限って参照する。

## Cloudflareの素材保管・配信

| 根拠 | 確認と設計への反映 |
| --- | --- |
| [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) | get/putのstream、Range（offset/length/suffix）、httpEtag、条件付き取得を提供。アプリ側で認証/所有者/期限とHTTPの206/416を扱う |
| [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) | 期限後の物理削除は通常24時間程度だが遅れる場合がある。D1の期限を即時の配信拒否に使い、lifecycleを補助にする |
| [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) | より具体的なpathが優先され、広いpathのpolicyを自動継承しない。新通常環境の取得専用pathを設計する根拠。既存のWorker全体保護を解除する根拠にはしない |
| [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) | URL所持者が使える期限付き認証。S3 API domain用で、custom domain向けではない。単一URLの失効をアプリのgrantと同じと仮定しない |

主Worker＋専用private R2＋短期grantの案はこれらの仕様からの設計判断で、実際のAccess/fal到達性やworkerdの画像decoder性能を検証したものではない。構成採用・上限値の採用・実配備許可を分離する。
