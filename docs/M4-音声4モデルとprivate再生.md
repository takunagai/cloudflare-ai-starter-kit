# M-4 音声4モデルとprivate再生

2026-10-04・追加のローカルコミット許可: 本人の依頼で検証済みの実装/試験24件を`84b0ecd`へ記録した。本文書を含む文書/根拠は別の1コミットへまとめる。最終Gitは[進捗](plan.md)と実Gitで確認する。M-5は別セッションを推奨し、実行許可・開始文は会話内で扱う。下記の未コミット/対象外Git操作は検証終了時点の履歴で、この追加許可をpush/PRやM-5へ広げない。

確認日: 2026-10-04。本人許可は音声4固定endpointの実装と隔離ローカル検証。M-0の採用済み条件と[M-1の予約・保持・復旧](M1-共通メディアジョブと保持.md)、[M-2の素材基盤](M2-素材基盤と画像4モデル.md)、[M-3の動画](M3-通常動画4モデルとprivate再生.md)を維持する。実生成・費用・権限・上流保持/ACLは未確認。M-5以降、D-2再複製、実接続・クラウド変更・配備・Secret・Git stage/commit/送信は対象外。検証の確定結果は[進捗](plan.md)を正本とする。

## 設定と管理場所

| 設定 | 内容・理由・変更時の影響 |
| --- | --- |
| `ENABLE_MEDIA` / `MEDIA_ALLOWED_MODELS` | 既定OFF/空一覧を維持。ONでも固定IDの許可一覧にないモデルは拒否。旧画像・標準機能・Jevとは独立 |
| `MEDIA_VERIFIED_AUDIO_MODELS` | 省略/`[]`で実音声生成と上流確認を拒否。音声4 IDの重複なしJSON部分集合。画像/動画の確認一覧で音声を有効にしない |
| 検証一覧への追加条件 | endpointごとのStore-IO/非公開ACL/保持/回収、利用権限、実形式・仕様、Gemini受付方式とwrapper込み入力を別承認の工程Eで確認する。fake成功・キーの存在・モデル採用だけでは追加しない |
| `MEDIA_BUCKET` / `FAL_KEY` | 専用private R2とserver内の資格情報。OFF後も既存素材の閲覧/削除にbindingを保持する。今回実リソース・実Secretは扱っていない |

管理場所は[入力/音声一覧](../src/lib/media-audio-options.ts)、[schema](../src/server/media/catalog.ts)、[音声adapter](../src/server/media/audio-driver.ts)、[共通stream保存](../src/server/media/stream-output-driver.ts)、[形式検査](../src/server/media/audio-inspection.ts)、[設定型](../src/server/media/policy.ts)、[画面](../src/components/audio-controls.tsx)。公開wrangler/5設定例と実設定は変更なし。既存schemaのformat/durationと検査receiptを使うため追加SQLは不要で、0001〜0010は変更していない。

## 固定入力と受付

| endpoint | 初版契約 |
| --- | --- |
| `google/gemini-3.8-flash-tts` | 単一本文＋固定30音声（既定Kore）、または正確に2つの異なるalias/音声＋1〜32の順序付き台詞。全体/台詞ごとの演技指示を本文と分離。単一/対話の混在、第三話者、未登録aliasを拒否 |
| `google/gemini-3.8-flash-lite-tts` | 同じ入力境界。別の固定endpointへ明示選択し、送信失敗時に切り替えない |
| `elevenlabs/tts/eleven-v4` | Rachel/Ariaだけ。ISO 639-1のアプリ部分集合ja/en/de/fr/es/it/pt/ko/zh/hi/ar、または省略。stability/similarity_boost各0〜1、任意seed、文字正規化auto/on/off、MP3 44.1 kHz・128/192 kbps |
| `elevenlabs/music/v2.5` | prompt、必須の整数3〜60秒、instrumental、MP3 48 kHz・128/192 kbps。duration×1000をmusic_length_msへ固定変換。composition_plan・音楽seed・音声参照は拒否 |

TTS本文・alias・台詞・演技指示は合計4,000 UTF-8 bytes、演技指示各500 code points。音楽promptは2,000 code points、JSON16 KiB、未知キー拒否を維持する。timestamps、生成streaming、raw PCM、音声クローン、マイク収録はUI/APIに追加しない。完成したWAV/MP3の認証配信streamは生成streamingと別。

### Geminiの8192 token制限

この版は外部token APIを呼ばず、**保守的な受付方式**を採用した。bytes利用量をtoken数と同一視せず、token数を返したり実測値として保存したりしない。根拠と留保は[公式確認](../references/m4-media-audio-20261004.md)に記録する。

受付スコアは `1024 + 64 × フィールド数 + 4 × 各フィールドのUTF-8長の合計`。長さは元の文字列とNFKC表現の大きい方を使い、本文・alias（各台詞の再出現も含む）・全体/個別演技指示・音声名を全件計上する。1024はwrapper、各64は区切り/roleの余裕。byte fallbackの考え方にさらに4倍の安全余裕を置き、合計8192以下だけ受付。孤立surrogateと制御文字も拒否する。実送信する本文は正規化・増補しない。4,000 bytesを満たしてもこの判定で先に拒否され得る。

これはモデル固有tokenizerの実測でも、非公開のfal wrapperを含む数学的な上限証明でもない。Googleの平均「約4文字/token」を換算式に使わず、一般tokenizerのbyte fallbackから保守的に受付を狭めたアプリ条件。モデル固有tokenizer/wrapperは未確認なので、実利用gateは閉じたまま。工程Eで対応計数またはwrapper込みの受付根拠を確認するまで実モデルを検証一覧へ加えない。

## 実形式・仕様と保存

音声1本32 MiBを先に予約し、Content-Lengthまたは結果file_sizeと実streamのbyte数を一致させる。上限超過・不足・切断・非identity encoding・MIME偽装を拒否。許可したCDN v3だけへ短期Bearerを付け、redirect・query/署名URL・別CDN・公開保存へのfallbackを拒否する。No-Retry/fallback無効、Store-IO=0/非公開ACL/3600秒lifecycleは画像/動画と同じ固定契約で、実適用は未確認。

private R2の隔離objectへFixedLengthStreamで保存し、検査は最大64 KiBのrange windowで行う。全音声のbuffer化・デコード待機列・変換/再符号化は追加していない。

| 形式 | 検査・対応範囲 |
| --- | --- |
| WAV | RIFF/WAVE実長、fmt/dataの順序・一意性、chunk数128以下、padding/末尾、PCM signed16-bit little endian・mono・24 kHz・blockAlign2・byteRate48000。dataのsample整列から秒数を算出。JUNK/LIST/bextは各1 MiB以内。他codec/float/extensible/RF64/raw PCMは拒否 |
| MP3 | MPEG-1 Layer III、44.1/48 kHz、CBR128/192 kbps、mono/stereo。全frameのheader/長さ/仕様一致、bit reservoir参照範囲、末尾を検査。通常ID3v2.3/2.4（flags0、1 MiB以下）とID3v1を許容。free format/VBR/CRC付き/未対応ID3等は変換せず拒否 |
| 再生時間 | WAVはsample数、MP3は全frame数×1152/sampleRate。Musicは要求秒数との差±0.15秒以内。MP3のencoder delay/paddingを含むframe時間でありsample精度の一致ではない |

MP3の完全なHuffman復号・全波形のデコード/知覚品質・instrumentalの知覚判定は行っていない。保守的な符号化/構造条件を満たすこととブラウザの合成音声再生を検証し、fal全出力との互換性・実生成品質は工程Eへ残す。未対応出力を成功や別形式へ暗黙変換しない。

## 回収・認証再生・削除・保持

動画と共通のstream保存境界を使う。書込み前のD1 claim、lease/CAS、同じjob/ordinal/object/receipt、最初の検証時刻/30日期限を維持。R2保存後に台帳だけ失敗した場合は既存receiptを再利用し、生成POST/CDN取得を繰り返さない。未完/書込み不明では最大32 MiB予約を保持。取消/本文消去/lease喪失/復旧gateが競合した結果を公開しない。R2 delete/head確認後だけ容量を解放し、利用量は返却しない。

WAV/MP3のGET/HEADはsession・所有者・ready/期限/版の確認を先に行い、R2取得後もD1状態を照合する。private/no-store、nosniff/no-referrer、audio/wavまたはaudio/mpeg。単一Range・suffix・末尾省略は206、範囲外/不正/複数Rangeは所有者だけ416。If-Rangeは強いETag一致だけ部分配信。不一致/弱い値/日付は全体200。HEADはRangeを無視し本文なし。切断後のseekで認証・期限・削除を再確認する。

所有権、参照ID/版/期限/grant、新旧合算枠、冪等性、受付不明の消費/同時/容量保持、本文終端30日/台帳終端90日、物理削除後の容量解放と復旧witnessは変更していない。WAV/MP3を画像参照へ流用しない。アプリの物理削除を上流コピー全件の消去と扱わない。

## 検証と次工程

合成PCM無音とffmpeg 8.1.2/libmp3lame製の3秒MP3（44.1/48 kHz×128/192 kbps、ffprobe照合済み）、fake上流、隔離workerd/D1/R2を使用する。byte fixtureはdeflateで保持し、通常テストにffmpegを要求しない。[試験](../tests/media-audio-inspection.test.ts)、[adapter/保存](../tests/media-audio-driver.test.ts)、[Range](../tests/media-audio-file.test.ts)、[HTTP smoke](../scripts/media-audio-smoke.mjs)を参照する。

合成previewは[専用Worker](../tests/media-audio-preview-worker.ts)が外部fetchを拒否し、専用markerを必須にする。公開設定から作った管理外fixtureとVite persistState/Wrangler --persist-toを一致させ、元利用DB・実設定へ適用しない。実接続gateのダミーONを実環境へ持ち込まない。実際のcheck/HTTP/Chrome結果と終了点検はplanに記録する。

最終コードのcheckは817 workerd＋7合成試験・lint/型/build成功。既定OFFの隔離preview標準smoke、音声ON合成previewの4 endpoint HTTP、現在のChromeでの設定/再読込/2タブ/取消/WAV・MP3再生とseek/削除/logoutも成功した。終了時の公開OFF buildは成功し、local・許可一覧空・FAL_KEY/追加R2なし・remoteなしを確認。自身のpreviewと確認2タブを終了、未コミット/空indexで引き渡す。各版と初回失敗の修正・検証範囲はplanを参照する。

次工程は別許可後のM-5。12件全体の統合/当該版の複製検証と、工程Eの限定実接続は未実施。M-4の成功をM-5、D-2再実行、CI、実生成や配備へ広げない。
