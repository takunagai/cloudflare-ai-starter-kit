# 工程E ─ 限定確認の制御実装と隔離検証

同日の追加許可で検証済みコード/SQL/試験28件を`69d151a`へローカルコミットした。文書は許可状態/継続判断を含む別コミットへまとめる。検証済みコードは変更せず同じ検査を繰り返していない。最終HEAD/cleanと再開地点は[plan](plan.md)を参照。以下の未commitは検証終了時点の記録。

確認日: 2026-10-05 JST。開始版はmain `e31571dee6f720e9afc4a2f6a699531b5b508d86`・clean。本人の「許可する。進めて」を制御差分の実装・隔離ローカル検証の許可として引き継いだ。実接続の実施結果とは区別する。採用済み用途/素材/予算・M-0と[詳細設計](工程E-用途と限定接続の事前整理.md)は維持する。

## 実装した境界と管理場所

| 対象 | 動作・理由・変更時の影響 |
| --- | --- |
| [専用policy/台帳](../src/server/media/probe-permit.ts) | `ENABLE_MEDIA_PROBE`は省略/OFFで404。固定承認版`e-sunburst-20261005-v1`、staging/standard/Access、AI/Jev/全通常拡張OFF、通常確認一覧空、別private R2、旧検証台帳空と復旧gateを要求。設定不備・未登録・DB不在/照会失敗は閉じる |
| [専用API](../src/server/media/probe-routes.ts) / [入口](../src/server/api.ts) | `/api/media-probe`と配下。同一origin・署名/issuer/AUD/expiry・本人owner・固定slotを照合。新規POSTはslot 1/request IDだけ、本文/モデル/URL/owner/driver/clockをHTTPから受けない。通常APIの生成/uploadはOFFのまま |
| [固定prompt/入力](../src/server/media/probe-permit.ts) | Sunburst text-to-image、1024角/medium/PNG/opaque/1枚/sync=falseと採用済み本文。normalize/hash/既存の容量・新旧合算・所有権/冪等性を使う。内部WeakSetで発行した承認だけをimage driverへ渡し、verified一覧へ追加しない |
| [0011](../migrations/0011_media_probe.sql) | run/slot/attempt/管理呼出し/判定/私有出力参照の追加だけ。共通予約とprobe消費を同一batch、dispatch claimと既存jobのlease/attemptを同一SQL+triggerで確定。総上限2に加えslotは1だけ、固定30分/末尾15秒拒否、失敗/unknown/取消で消費を戻さない。起動/HTTP/migrationでrunをseedしない |
| 送信直前 | 固定DB時刻・状態/停止・復旧、job/owner/leaseとdispatch claim一致を検査し、直前のサーバー時刻でも締切を照合。D1と外部fetchは原子的にできないため、既にclaimされた要求の停止競合はunknownとして保持。固定No-Retry/No-Fallback/Store-IO=0/3600秒/初期private ACLを維持 |
| [操作別の共通処理](../src/server/media/service.ts) / [image driver](../src/server/media/image-driver.ts) | 専用承認で既存jobのstatus/result/cancel/回収だけを扱い、受付停止後も継続。通常経路は確認一覧を増やしてもprobe jobのrefresh/retry/new POSTを拒否。nullable metadataは従来どおり不適合、別CDN/公開保存/再生成へ切り替えない。再回収で出力URLが変われば拒否 |
| [Access認証](../src/server/auth/access.ts) | probe ONの環境だけ、署名検証後のAccess JWT寿命を最大1時間＋既存5秒許容に制限。通常環境の認証契約は変えない。実Access application/policy/sessionを設定済みとする証拠ではない |
| [所有者配信](../src/server/media/assets.ts) | 閉鎖/24時間照合窓後のprobe job/素材は通常GET・一覧からも拒否。未知/別ownerへサイズ/validator/取得先を返さない。R2の書込み・物理削除・容量解放は既存receipt/CASを使う |
| [保持/復旧](../src/server/media/retention.ts) | private出力参照は本文早期消去/終端30日で消去。本文なしrun/消費/管理枠/判定は閉鎖かつ全job終端90日後だけ退役、unknownは日数で解放しない。witnessに最小probe記録と最初の出力観測時刻を加え、URL/tokenは含めない。不一致なら復旧gateを閉じたまま |
| [画面](../src/components/media-probe.tsx) | `/media-probe`。固定内容/1要求、JSTの固定窓/消費、状態・回収/診断・本文/出力消去・アプリ内閉鎖を表示。品質/課金/上流削除は本人報告と明記し、自動判定へ格上げしない。Access閉鎖・token失効/logoutは外部の別操作 |

既存0001〜0010、依存/lockfile・Node26.10.0/pnpm12.6.0・公開wrangler/5例・元DB/実設定・既存M-5/D-2隔離先・保護フック/例外は変更しない。新しい実リソース、Cron/Workflow/automation、admin鍵のアプリ追加、汎用CLIはない。

## 管理枠・診断と実確認の限界

管理枠はjob単位のD1予約で、再読込/再起動で補充しない。statusは20秒以上間隔・60分/180回、result最大3回、cancel1回、ACL2回、匿名GET2回、token発行4回、追加Bearer診断GET4回、token/自然期限観測各1回。終了後status照合3回を別枠とし、停止時刻＋24時間で専用経路を閉じる。上流admin削除は本人の別手段で最大3試行を管理し、アプリは本人報告だけを記録する。

設計時のtoken3回/診断GET3回案を4回へ具体化した。回収の1tokenに加え、診断tokenの期限前正常取得→同じtokenの期限後拒否→新tokenの正常取得と、自然期限後の新token確認が必要なため。生成POST/画像枚数/30分・採用M-0条件は増やさない。管理操作も実費照合へ含める。

[診断](../src/server/media/probe-diagnostics.ts)は作成時ACLのGET/匿名拒否を対照し、変更APIで後付けprivate化しない。tokenはサーバーメモリだけに最大345秒、各fetchは15秒。中断/通信不明はunknown、HTTP/ログ/DBへtokenを出さない。自然期限は最初の出力観測から3600秒後、有効な所有者tokenでも404/410を確認する。匿名403や期限切れtokenを消去証拠にせず、全コピー/backup消去も保証しない。

workerdの実HTTPでfixtureの新Requestへredirect=errorを指定すると失敗した。限定経路ではmanual＋3xx拒否を採用し、資格情報を別hostへ転送しない。[公式Request仕様](https://developers.cloudflare.com/workers/runtime-apis/request/)と実装試験を区別する。他11件/通常driverの実上流確認は今回に含めない。

## 隔離ローカル検証

- 新しい`.wrangler/e-preview/state`と`.wrangler/e-off/state`だけを使用。旧M-5/D-2や元利用DBを再使用・再複製しない。0011は新隔離DBとVitest内D1だけへ適用。
- [公開テンプレートからのfixture設定作成](../scripts/media-probe-local-config.mjs)は既存フォルダがあれば停止し、状態をリセットしない。追加の実リソース/実Secretはない。
- [合成Worker](../tests/media-probe-preview-worker.ts)はlocal/loopbackのみ、実FAL_KEYがあれば拒否。固定fake/JWKS以外の外部fetchを拒否し、署名付き合成Accessを実検証する。通常gate/生成/uploadはOFF。初回setupもTEST_ONLYの明示POSTだけで、既存runを作り直さない。
- [専用Vite設定](../tests/media-probe-preview.config.ts)と[OFF設定](../tests/media-probe-off-preview.config.ts)はremoteBindings=false、persist先を明示、envDir=false。Viteの[公開仕様](https://vite.dev/config/shared-options#envdir)でdotenv読込無効化を確認した。ブラウザは現在のChrome/既存profileを使用。
- [境界/診断試験](../tests/media-probe.test.ts)と[空/upgrade/再適用/失敗DDL試験](../tests/media-probe-migration.test.ts)をworkerd/D1/R2で実行。競合・同ID/不適合入力・未登録・時間境界・3xx・通常経路/他モデル拒否・1時間超JWT・停止/unknown/容量保持・閉鎖/復旧・90日/早期消去を対象にする。

ChromeのON合成画面で固定内容/1要求・締切不変・1要求消費/再送不可、回収/owner画像表示、ACL/匿名拒否、token期限/自然期限、出力削除・本文/出力参照消去・アプリ内閉鎖を確認した。token/自然期限は合成の時間短縮であり実期限の証拠ではない。合成画像の表示は実生成品質の証拠ではなく、品質/課金/上流admin削除の実確認は行わない。

終了時のON隔離DB集計はmigration11、消費1・閉鎖1、本文0・出力参照0・残素材0・容量保持0。台帳を残しており再起動/再配備で枠を復活させない。新OFF previewの標準HTTP smoke（登録/固定チャット/履歴/再試行/削除/logout・全拡張/Jev OFF）は成功し、probe APIは404。全体checkの最終結果と終了点検は[plan](plan.md)へ記録する。

当該最終checkは895 workerd＋7合成・lint/型/build成功。自身の4199/4173待受とChromeの検証2タブは終了済み。公開設定の本体成果物はOFFで、合成Workerを配備対象へ混ぜていない。元のDB/既存隔離先・実設定・依存・保護フックは保持し、未ステージ/未コミットで引き渡す。実接続に進むときは以下の実対象と承認された成果物を別に照合する。

## 実fal接続の許可と残る条件

2026-10-05、本人からfal.ai実接続の許可と作業用一時API Key発行済みの申告を受領した。キー値/名前/長さ/hashは取得・転記していない。本人は次の3項目を「3項目とも確認済み、購入不要」と回答した。

1. Sunburst利用権限と採用済み公開架空promptを送れる契約/上流保持条件。
2. 実単価・credit残高/最低購入・共有枠を含む追加費用$1目安・自動補充OFF、購入不要。
3. 完了要求の上流削除を行う担当/権限。

これは本人照合の申告で、エージェントによるアカウント再照会・実料金/保持/削除の実測とは区別する。実接続許可は保持し、同じ許可を再質問しない。実接続はまだ0回。キーの人間投入先、今回専用stagingの存在/実対象、非公開対応表、開始絶対時刻と対象Worker版/DB/Access/終了操作が未確定。専用環境の状態への質問は回答待ち。過去の旧検証staging/DB/残枠を転用しない。

未作成の場合の次案は新主Worker1・別D1 1・専用private R2 Standard 1・本人限定Access application/policy、1時間session。参照取得例外/公開R2/追加モデル・メール/決済/AI/Jevはない。実設定は管理外、秘密投入は本人が会話外で行う。候補の外部操作はD1作成/0001〜0011適用、R2/Access作成、初期OFF配備→本人FAL_KEY投入（即時deployを伴う）→限定ON配備→終了OFF配備、本人認証/必要OTP、固定run/slot登録、1生成と承認済みの回収/課金/削除/アクセス閉鎖。実対象・操作回数・共有費用と終了方法を揃えた実行票でクラウド操作を別承認する。既存ならその実対象と当該版への更新差分を先に照合する。どちらも今回の接続許可だけでリソース作成/配備・実Secret操作を始めない。
