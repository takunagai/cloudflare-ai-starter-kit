# M-3 通常動画・private stream・Rangeの公式確認

確認日: 2026-10-04。公開仕様の読み取りだけ。実生成、アカウント・価格・Secret・クラウドは照会していない。[アプリ契約と未検証範囲](../docs/M3-通常動画4モデルとprivate再生.md)を分ける。

| 公式一次資料 | 確認・採否 |
| --- | --- |
| [text-to-video schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Ftext-to-video) | 4件とも現在のdurationは0.92〜15のnumberで、約0.7秒の延長がある。過去資料の整数5〜15と区別し、アプリの採用済み受付5/10秒を維持。解像度3種/6縦横比を確認 |
| [image-to-video schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Fimage-to-video) | image_url/end_image_urlの一方でcanvasが決まる。両省略のtext切替は拒否。aspect_ratioを送らない |
| [reference-to-video schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Freference-to-video) | 順序付きreference_image_urls/adaptive/始終画像を確認。動画/音声・middle_image_url/middle_frame_timeは拒否。公式9枚より狭い1〜4枚を維持 |
| [camera-controls schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=minimax%2Fh3-max%2Fcamera-controls) | 開始画像、正規化timeの2〜12キー、符号付きazimuth、既定480P。公式32回転より狭い720度を維持 |
| [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) / [FixedLengthStream](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/) | range/etag/streamと既知長のstreamを使用。D1/R2を跨ぐ原子性は仮定せず、容量は削除確認まで保持 |
| [ローカル保存先](https://developers.cloudflare.com/workers/local-development/local-data/) / [Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) | persistState.pathと--persist-toを同じ隔離先へ指定。固定Wrangler4.141.0のhelpも確認 |
| [RFC 9110 Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-range) / [If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-range) | GETの206/416、HEADのRange無視、強いvalidatorを確認。アプリはM-0どおり強いETagだけ採用し、日付ではRangeを使わない |
| [W3C ISO BMFF](https://www.w3.org/TR/mse-byte-stream-format-isobmff/) | ftyp/moov/mdat、codec configuration、外部data reference拒否の根拠。MSE全体への対応とせず、通常MP4の限定検査とする |

Web取得ツールでfal schemaが取得できず、公開URLを通常HTTPで取得して本文を確認した。安全・認証拒否ではなく取得手段の非対応。規約読取りの修正許可とは分け、保護フック/例外は変更していない。合成のcodec/Chrome再生成功は、実falのACL/Store-IO/保持・生成品質の証拠ではない。

## 同日の正常系補強

[FFmpeg libx264公式資料](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb)と[color source公式資料](https://ffmpeg.org/ffmpeg-filters.html#color)の本文、導入済みffmpeg 8.1.2のencoder helpを確認。profileの指定とcolorのsize/rate/durationを使用し、例として`color=c=blue:s=1920x1080:r=24:d=10`、libx264/High/yuv420p/GOP24/faststartで合成した。出力はffprobeでもHigh・期待寸法・10秒・240フレーム・B-frameを照合し、workerdではSPS profile_idcとcttsの存在を検査した。fixture生成だけに使い、依存やグローバル環境を変更せず、通常check/CIにはffmpegを追加しない。実falの映像仕様・品質の確認とは別。
