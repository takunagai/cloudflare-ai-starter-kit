# M-2 素材と画像adapterの公式確認

確認日: 2026-10-04。公開公式本文・配布元の読取り。実fal/Cloudflareアカウント照会はなし。採用値・設定・制約は[M-2設定メモ](../docs/M2-素材基盤と画像4モデル.md)へ分ける。

| 根拠 | 確認・採用・制約 |
| --- | --- |
| [Sunburst edit](https://fal.ai/models/openai/gpt-image-2.5/sunburst/edit/api) / [Flare text-to-image](https://fal.ai/models/openai/gpt-image-2.5/flare/text-to-image/api) / [Sunburst text-to-image](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api) / [Flare edit](https://fal.ai/models/openai/gpt-image-2.5/flare/edit/api) | image_size、6品質、num_images、背景、output_format/output_compression、sync_mode、editのimage_urls/mask_urlを固定adapterへ変換。アプリの1〜4枚/1〜8参照はM-0の狭い受付値。各endpointの実生成は未確認 |
| [fal queue](https://fal.ai/docs/documentation/model-apis/inference/queue) | submitとstatus/result/cancelを分離。固定queue pathと保存IDを使う。cancelはPUT。返却URLの無条件利用や生成再送をしない |
| [fal platform headers](https://fal.ai/docs/documentation/model-apis/common-parameters) / [file ACL](https://fal.ai/docs/documentation/model-apis/file-access-controls) | No-Retry/fallback停止、Store-IO、Object-Lifecycle-Preferenceとprivate ACL、CDN v3 token交換・expiration_secondsを確認。ヘッダー送信と実適用を区別し、検証済みモデルの別gateを置く。匿名拒否/削除/保存契約は工程E待ち |
| [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) / [Workers memory](https://developers.cloudflare.com/workers/platform/limits/#memory) | put/getはstream、書込み/削除は強い整合性。delete後head確認とD1 CASで容量を解放。128 MBはisolate単位でJS/WASMを合算。画像処理はisolate内1件へ限定 |
| [PNG 3仕様](https://www.w3.org/TR/png-3/) | CRC、IHDR/PLTE/tRNS/IDAT/IEND、scanline filter・Adam7を参照し、実展開量を制限。APNGは拒否する |
| [jSquash公式repo](https://github.com/jamsinclair/jSquash) / [Cloudflare例](https://github.com/jamsinclair/jSquash/blob/main/examples/cloudflare-worker/README.md) / [JPEG codec](https://github.com/jamsinclair/jSquash/blob/main/packages/jpeg/codec/dec/mozjpeg_dec.cpp) | wasm moduleの明示import/instance、実pixel decodeを採用。JPEG警告付き補完を拒否し、EXIF自動回転を使わない。workerdでの成功を実負荷性能へ広げない |
| [JPEG配布元](https://www.npmjs.com/package/@jsquash/jpeg/v/1.6.0) / [WebP配布元](https://www.npmjs.com/package/@jsquash/webp/v/1.5.0) / [JPEG変更履歴](https://github.com/jamsinclair/jSquash/blob/main/packages/jpeg/CHANGELOG.md) / [WebP変更履歴](https://github.com/jamsinclair/jSquash/blob/main/packages/webp/CHANGELOG.md) | 1.6.0/1.5.0をexact固定。engines/peerの宣言なし、Apache-2.0。WebPの推移依存wasm-feature-detectもlockで固定。pnpm auditの照会結果は全severity0。Rust/C/C++内部や全入力に対する安全保証ではない |
| [Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) / [D1 migration CLI](https://developers.cloudflare.com/d1/wrangler-commands/#migrations-apply) | 固定版の型/helpも照合。専用persistState/persist-toを使う。previewはbuild成果物の設定を使うため、素材ONは合成設定でbuildしてから検査する。クラウド操作なし |
