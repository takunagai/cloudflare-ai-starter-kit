# M-3 通常動画4モデルとprivate再生

確認日: 2026-10-04。本人許可による実装・隔離ローカル検証。[M-1の所有権・予約・保持・復旧](M1-共通メディアジョブと保持.md)と[M-2の素材・grant・画像4モデル](M2-素材基盤と画像4モデル.md)を維持する。実fal/AI/Jev/メール/決済、実R2/Access、配備・費用・生成品質は未検証。M-4以降とD-2再実行/再複製は対象外。

## 設定と管理場所

| 設定 | 動作・変更時の注意 |
| --- | --- |
| `ENABLE_MEDIA` / `MEDIA_ALLOWED_MODELS` | 既定OFF/空配列を維持。ONかつ固定許可IDだけ新規生成・アップロードを受付。旧画像・標準チャット・Jevとは独立 |
| `MEDIA_VERIFIED_VIDEO_MODELS` | 省略/`[]`で動画の実生成・上流確認を拒否。動画4固定IDの重複なしJSON部分集合。画像の確認一覧と独立。各endpointのACL/Store-IO/保持/非同期回収・権限を工程Eで実確認するまで追加しない |
| `MEDIA_BUCKET` | RAGと別のprivate R2。OFF後も保存済み素材の閲覧・削除にbindingを保持。公開経路・実bucketは作成/変更していない |
| `FAL_KEY` | serverだけ。今回のHTTP/画面は外部通信を拒否する合成Workerとダミーだけ。実Secretの閲覧・投入なし |

管理場所は[動画adapter](../src/server/media/video-driver.ts)、[MP4検査](../src/server/media/video-inspection.ts)、[SPS検査](../src/server/media/h264-metadata.ts)、[配信](../src/server/media/video-file.ts)、[画面](../src/components/video-controls.tsx)、[0010](../migrations/0010_media_video_grants.sql)。公開wrangler/5設定例の既定OFF、固定依存/lockfile、0001〜0009、元利用DB・実設定は保持する。ローカルfakeのgate設定を実環境へ持ち込まない。

## 固定endpointと入力

| endpoint（すべて`minimax/h3-max/`配下） | 契約 |
| --- | --- |
| `text-to-video` | 5/10秒（既定5）、480P/768P/1080P（既定768P）、6縦横比（既定16:9）、任意seed |
| `image-to-video` | 開始/終了の少なくとも一方。終了だけでも可。aspect_ratioを送らず、開始、なければ終了画像のcanvasを検査。画像なしの暗黙text切替を拒否 |
| `reference-to-video` | 1〜4枚の順序付き・重複なし参照、開始/終了各1枚を追加可。adaptiveを含む専用縦横比。開始/終了だけならi2vを明示選択 |
| `camera-controls` | 開始1枚、2〜12キー、既定480P。静止・接近・旋回と時刻/方位角/仰角/距離を編集。timeは0〜1を保存/送信し、秒表示だけdurationに比例換算 |

cameraは有限数、先頭0・末尾1・厳密な昇順、仰角−90〜90度、距離0.1〜10、隣接方位差の絶対値総和720度以内。符号/周回を保持し、360度で剰余化しない。画面とサーバーは同じ純粋検査を使用。prompt4,000 code points・JSON16 KiB・参照合計50 MiB・素材ID/版/所有者/期限は維持。任意JSON、参照動画/音声、target audio、中間画像、URL取込みを拒否する。

`image_url`/`end_image_url`/`reference_image_urls`/`camera_trajectory`へ固定変換。safety checker ON、prompt expansion disabled、sync false。1claimの生成POST、No-Retry/fallback無効、開始期限120秒、Store-IO=0、非公開ACL/3600秒lifecycleを継承する。応答中の任意URLを使わず、固定IDと保存済みprovider IDからqueue経路を構成する。0010はgrantのCHECKへstart/endを追加し、既存のhash・ID/版・所有者・期限・回数/転送予約・失効を保持。TTL30分、GET20/HEAD20、素材容量10倍、毎回のリンク/取消/本文消去/復旧gate照合も維持する。

## 出力検査・保存・部分回収

生成前に動画1本256 MiBを予約。許可したCDN v3だけを短期Bearerで回収し、redirect・query/署名URL・別host/CDN・公開保存への切替を拒否する。上流の実ACL/保持/Store-IO適用は未確認。

HTTP MIMEはvideo/mp4、encodingはidentity、正常なContent-Lengthまたは結果file_sizeが必要。両方あれば一致を要求。実byte数を数えてFixedLengthStreamへ送るため、容量超過・不足・切断を停止する。全体buffer・全動画の待機列・再符号化は追加しない。

書込み前にobject/状態をD1へ記録し、private R2の隔離objectへ保存する。保存後はR2 rangeでftyp/moov/mdatを照合。moov8 MiB以下、box/track/sample数は有限。通常の非fragmented MP4、progressive H.264（avc1/avc3）、任意AAC trackを対象とし、外部data reference・回転matrix・暗号化/未対応codec・異常なsample数/時間/offset/重なりを拒否する。SPS・sample entry・tkhdの寸法を一致させ、最大辺4096/8,294,400画素、解像度の短辺±32px、指定比率または元canvasの比率±5%を検査する。これらは保守的なアプリ受入条件で、fal全出力との互換性を確認した値ではない。

公式説明の約0.7秒延長を考慮し、要求秒数−0.05〜＋0.75秒を受付。movie/track/sample時間を照合し、利用枠は採用済みの要求5/10秒を使用する。完全なフレームデコードや知覚品質の保証ではない。未対応形式を変換せず不正回収として扱い、工程Eで実出力を確認する。

動画1本でもobject保存と台帳確定の間の失敗を部分回収として扱う。同じprovider ID/保存済みreceiptを再利用し、素材ID・bytes・最初の時刻/期限を変えず、生成や保存済みCDNダウンロードを繰り返さない。未完/書込み不明は最大予約を保持する。取消と書込みが競合した結果は公開せずdeletingへ渡し、R2 delete/head確認後だけ容量を解放する。lease喪失・復旧gate・本文消去は確定を拒否する。

## 認証付き再生と保持

`GET/HEAD /api/media/assets/:id/file`はsession・所有権・ready/期限を先に確認。R2 size/ETagと取得後のD1状態/版を再照合し、private/no-store・nosniff・no-referrerで配信する。未認証/別所有者へETag・容量・存在を返さない。

| 要求 | 応答 |
| --- | --- |
| GET・Rangeなし | 200、全体の正確なContent-Length |
| 単一`bytes=start-end`/`start-`/`-suffix` | 206、正確なContent-Range/LengthとAccept-Ranges。終端超過/大きいsuffixは実量へ限定 |
| 不正/範囲外/複数Range | 所有者だけへ416、`bytes */size`、本文なし |
| If-Range | M-0どおり強いETag一致だけ206。不一致・弱い値・HTTP日付は全体200 |
| HEAD | Rangeを無視し、全体長/validator、本文なし |

切断はR2 streamのcancelへ伝わり、次のseek要求で認証/期限/削除を再照合。削除とgetの競合は取得後も拒否する。既に送ったbytesの回収や上流コピーの削除を保証しない。参照7日・生成30日、本文終端30日/台帳終端90日、未終端/受付不明の保持、新旧合算、物理削除後の容量解放・復旧条件は不変。

## 検証と次工程

隔離workerd/D1/R2、fake上流、合成の青一色MP4/無音AACだけ。0010は空DB・0009済み合成DB・再適用0・失敗DDL rollbackで検証。[HTTP smoke](../scripts/media-video-smoke.mjs)は合成Worker markerが必須で、元DB/実設定へ実行しない。合成登録の429には待機して再試行し、認証制限は変更しない。最終版の結果は[進捗](plan.md)に記録する。

次は別許可後のM-4音声。M-5全12件統合/その版の複製、工程Eの実接続・費用/ACL/保持/品質は別工程。今回の結果をM-4以降・実接続・CI・クラウド・配備の成功へ広げない。

初回M-3のcheckは689 workerd＋7合成試験・lint/型/buildが成功。4 endpoint合成preview HTTP、Chromeの設定/待機/再読込/取消/再生/seek/削除と、既定OFFの別隔離preview標準smokeも成功した。以下の正常系補強後は709 workerd＋7合成試験のcheckを確認した。結果・版・終了点検はplanを正本とする。変更は未コミット。

### 10秒・高解像度・High profileの正常系補強

2026-10-04、本人の追加許可で次の4合成MP4を追加した。全件10秒・24fps・240フレーム、H.264 High・yuv420p・B-frameあり。ffmpeg 8.1.2のlibx264で作成し、ffprobeとAVCのprofile_idc=100を別に照合した。幅/高さに16の倍数でない値を含め、SPSのcropを検査する。byte fixtureとして保存し、通常試験/CIにffmpegを要求しない。

| 解像度・方向 | 実寸法 | 縦横比 |
| --- | --- | --- |
| 768P・横長 | 1366×768 | 16:9 |
| 768P・縦長 | 768×1366 | 9:16 |
| 1080P・横長 | 1920×1080 | 16:9 |
| 1080P・縦長 | 1080×1920 | 9:16 |

[合成fixture一覧](../tests/media-video-high-fixtures.ts)、[検査試験](../tests/media-video-inspection.test.ts)、[保存までの試験](../tests/media-video-driver.test.ts)を追加。検査4件と、4 endpoint×4素材の16件で追加20試験。実workerdの隔離D1/R2、fake上流で、入力設定/参照grant→MP4/SPS/時間検査→private R2保存→metadata確定を通し、保存bytes/形式/寸法/10秒・private/no-store・実容量への予約置換・消費10秒・30日期限・再取得のID/時刻不変・生成POST/CDN取得各1回・suffix Rangeの実bytesを確認した。アプリ・SQL・依存・公開設定・実設定/元DBを変更していない。今回HTTP/Chromeは再実行せず、初回結果と今回のworkerd/チェック結果を区別する。実上流・映像品質の確認待ちは不変。
