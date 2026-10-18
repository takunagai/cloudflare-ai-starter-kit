# モデル接続

2026-10-02・C-1: [local](presets/local.md)・[個人/社内](presets/internal.md)・[公開サービス](presets/public.md)の導入文書を整備しました。B-4の[公開5例/build境界](公開プリセットとbuild境界.md)はlocalの固定応答、非localのAI OFF、全例Jev/拡張OFFです。設定やモデルを今回変更せず、以下の一覧は固定コードのcatalogとして示します。提供継続・実権限・価格は今回再照会していません。実接続は[工程E前の停止条件](operations.md#工程e前の停止条件)の確定と別承認後です。

2026-10-02・B-3J実装完了: Jevは`src/server/decisions/`の固定fetch/3型serviceとして実装・fake上流でローカル検証済みです。固定版`jev-1.13.0`、remote時だけ`TYPESAFE_API_KEY`をサーバーで使用します。既定OFF・チャット一覧/枠とは独立。[契約・設定の管理](Jev-B3J-実装前契約.md)と[検証結果](archive/B3J完了-次セッション開始プロンプト.md)を参照。SDK/依存追加・実接続・キー投入はなく、上流の料金/保持/権限/日本語品質は工程E前の条件です。次の契約確定節の「未実施」は当時の履歴です。

2026-10-02・Jev契約確定: Jevは本書のチャット一覧へ混ぜず、[B-3J実装前契約](Jev-B3J-実装前契約.md)の型付き判断serviceとして扱います。本人の3組への回答で、固定4候補分類＋3種内部service、独立枠/全数値、本文/結果/hashなしの要求台帳・終端90日・結果再表示なし・unknown消費/同時枠保持を設計採用。固定版`jev-1.13.0`を公式再確認しましたが、service/SDK/実接続は未実施です。上流の実料金/自動補充・権限/品質・保持/unknown修復は工程E前の確認事項。チャットの上限・履歴・B-3の実装境界は変更していません。

確認日: 2026-09-27。AI SDK 7のproviderをサーバーで生成する。`listModels` は表示用のID・名称・provider・設定済みフラグだけを返し、`getModel` はコードにある許可一覧から選ぶ。ブラウザから任意のモデル名、endpoint、APIキーを受け付けない。

2026-10-02・B-3: `ai/catalog.ts`を設定判定とadapterの正本にしました。同期`listModels/getModel`もAI_MODE/AI_ALLOWED_MODELSを検査し、DBは読みません。認証済み`/api/models`は通常stagingの旧台帳存在検査を合成し、不適合なら全件`available:false`とします。チャット受付・予約・各モデルstep直前、Workflow受付/推論stepも非同期guardを通します。既知の選択外モデルは503、未知IDは有効なチャットポリシー下で400。通常local/productionは新設定省略でOFF（既存loopback demoだけ互換）となり、Secret/bindingだけでは直接adapterも有効にしません。下記の導入手順だけで新しい通常環境を配備せず、[工程B〜D](用途別プリセット-開発計画.md)の完了を確認してください。

## 初期の許可一覧

2026-09-29の現在状態: 指定FP8は`7abc1696`で実接続2回・逐次表示を確認し、終了後はAI OFF・binding除去済み。後続依存修正版は未配備です。他provider・LM Studioは実接続未検証で、必要な用途だけ次に選びます。stagingは検証フラグOFFでも指定FP8/固定窓/総枠の制約を解除しません。[最終レビューと次の用途](main取り込み-最終レビューと次の用途.md)を参照してください。

以下の2026-09-28追記はモデル変更時点の履歴です。

2026-09-28追記: 廃止対象の旧Workers AIモデルをFP8版へ更新しました。公開IDも変更し、旧IDを別モデルへ転送しません。[最小検証計画](実AI接続-最小検証計画.md)と[制御の実装状況](実AI検証制御-実装状況.md)を参照してください。fakeによるローカル検証済み、実接続は未実施です。他providerの提供状況を今回一括再確認したという意味ではありません。

| 画面に渡すID | 接続先モデル | 必要なサーバー設定 |
| --- | --- | --- |
| `openai/gpt-4.1-mini` | `gpt-4.1-mini` / Chat Completions | `OPENAI_API_KEY` |
| `anthropic/claude-haiku-4-5` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| `google/gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `workers-ai/llama-3.1-8b-fp8` | `@cf/meta/llama-3.1-8b-instruct-fp8` | Workers AI binding `AI`。旧検証stagingだけは固定窓/総枠の既存設定も必要 |
| `openrouter/openai/gpt-4.1-mini` | `openai/gpt-4.1-mini` | `OPENROUTER_API_KEY` |
| `lm-studio/local` | サーバー側の `LM_STUDIO_MODEL` | ローカル環境と `LM_STUDIO_BASE_URL` |
| `local/demo` | AIを使わない固定応答 | ローカル環境と `LOCAL_DEMO=true` |

adapterの`available`は同期ポリシーの選択と設定充足、HTTPモデル一覧の`available`はさらに台帳検査を通過した意味です。旧検証では従来の固定窓判定も維持します。キーの有効性、残高、実利用権限、provider稼働状況を照会した結果ではありません。選択外/未設定adapterは外部通信前に`ModelUnavailableError`になり、HTTPチャットは固定コードを返します。モデル一覧は推論しません。

Googleの2.5系は確認時点で新規利用が制限されているため、新規プロジェクト向けとして公式が案内する3.5 Flash-Liteをサンプルにした。これは全モデルの性能・価格比較の結果ではない。利用モデルを追加・変更する場合は `src/server/ai/catalog.ts`の公開定義と`providers.ts`のadapterを変更し、選択/直接取得の契約テストと説明を更新する。無制限なモデルID入力や自動fallbackは導入していない。

## 導入手順

この順序は選んだ接続を準備する手順で、C-1では1〜3の項目整理までです。4〜5の実設定・実接続は別承認後に扱います。

1. [用途別入口](../README.md#用途を選んで始める)から環境・認証を選ぶ。共通localの固定応答や非localのAI OFFのままで準備でき、不要なproviderのSecret/bindingは追加しない。
2. チャットは`AI_MODE=selected`、`LOCAL_DEMO="false"`、`AI_ALLOWED_MODELS`にこのcatalogの公開IDだけを非空JSON配列で明示する計画を立てる。空/重複/未知IDを拒否し、selectedに`local/demo`・Jev・falを混ぜない。AI OFF/demoではallowlistは省略または`[]`だけ。実際の設定変更はまだ行わない。
3. [工程E前](operations.md#工程e前の停止条件)に、提供継続・実権限・課金単位・保持/削除・人数・共有利用・総予算・期間・終了操作を確認して承認対象を具体化する。Workers有料プランの月額に他社モデルの料金は含まれない。過去の検証枠や予算を新用途へ流用しない。
4. 別承認後だけ、ユーザーが会話外で対象環境のSecretを投入する。[Secrets運用補足](../rules/secrets.md)に従い、値をチャット・コマンド引数・ログに出さない。Workers AIは各環境へ`AI` bindingを個別に設定する。build/配備先は[B-4の固定対応](公開プリセットとbuild境界.md#buildの選択と拒否)に従い、旧検証stagingを通常へ転換しない。
5. 認証済みモデル一覧で選択と設定充足を確認し、承認した回数・予算・期間内の小さなリクエストで実接続する。設定済み/available表示は資格情報・残高・実権限の照会結果ではない。実行時も認証・所有権・原子的枠・台帳・モデル選択を再確認し、出力上限/timeout/retry 0を維持する。生エラーをHTTPやログへ丸ごと返さない。

資格情報だけでは有効にならない点は旧版からの互換性変更です。AI_MODE省略→demoを保持するのは安全なloopback local＋LOCAL_DEMO=trueだけで、他の通常経路はOFFです。旧検証stagingでは新AI設定を混ぜず、従来の固定FP8・30分・総3回・単一所有者・失敗消費・閉鎖を保持します。新しいAI設定への書換えや台帳の削除/更新で解除しません。

Jevは専用`JEV_MODE`、fal等は対応`ENABLE_*`で独立して制御します。AI_MODEだけで実メール・Jev・画像・決済の全接続を止められると説明せず、終了操作を個別に定義します。

料金は可変なのでコードに単価を埋め込まない。既定allowlistでも無課金を保証しない。アプリの回数/文字数/token上限は支出額そのものではないため、provider側の予算制限も併用する。キーがない場合に別providerへ自動転送することはない。

## ローカル動作確認

`APP_ENV=local` とloopbackの `APP_ORIGIN`、`LOCAL_DEMO=true` が揃った場合のみ、`local/demo` を有効にする。画面上の名称と応答本文の両方へ「AI未使用」と表示する。固定文を返し、ユーザー入力を反射せず、外部通信・課金を行わない。テキスト生成とstreamingの両方を確認できるが、実モデルの推論品質やtool選択の検証にはならない。

エージェント拡張で `draftNote` が渡された場合は、固定の「ローカル確認用下書き・AI未使用」を一度だけ提案し、次のstepで固定応答を返す。承認・保存は通常のAPIを通るため、人間の承認なしでメモを保存しない。この動作はtoolの接続確認用であり、AIによるtool選択ではない。

staging/productionではdemoとLM Studioを無効化する。API入口でも実リクエストの宛先がloopbackか確認し、local設定のまま公開された場合は拒否する。ローカルフラグを公開環境の設定へコピーしない。

## LM Studio

1. 開発PCでLM Studioのローカルサーバーを起動し、使用するモデルをロードする。外部公開やTunnelは不要。
2. サーバー設定に `LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1` と、ロードしたモデルの識別子を `LM_STUDIO_MODEL` として設定する。これらはモデル名/ローカルURLでありSecretではない。エージェントは実環境一覧を表示せず、設定はユーザーが行う。
3. 別選択として`APP_ENV=local`とloopbackの`APP_ORIGIN`、`LOCAL_DEMO="false"`、`AI_MODE=selected`、`AI_ALLOWED_MODELS='["lm-studio/local"]'`を対象設定に明示する。既定demoから自動接続しない。環境や実設定の変更は承認された範囲で本人が行う。
4. そのlocal対象で起動して`lm-studio/local`を選び、実プロセスとの疎通を確認する。LM Studioのモデル名はブラウザから自由指定できない。通常の固定応答試験やfakeテストはLM Studioの実疎通の証拠ではない。

接続先はHTTPの `localhost` / `127.0.0.1` / `[::1]` と `/v1` に限定する。userinfo・query・fragmentや外部ホストは拒否し、HTTP redirectも追わない。クラウドWorkerのlocalhostは開発PCを指さないため、クラウドからの接続はサポートしない。ローカルサーバー側で追加認証を要求する設定は、このサンプルの対象外。

## AI Gateway（任意の運用拡張）

標準は各providerへの直接接続で、Gateway設定を要求しない。導入する場合はCloudflareで専用Gatewayを用意し、ログ保存とデータ取り扱い、追加の認証、予算制御の仕様を確認する。例えばOpenAI providerのサーバー側 `baseURL` を `https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway-id>/openai` へ向ける方法がある。実際のIDやSecretをコードへ埋め込まず、固定した環境設定として扱う。動的なクライアントURLは許可しない。

この接続例は現行コードで有効になっていない。導入時はproviderのURL・認証方式・レスポンス互換性を検証し、他providerへ設定をそのまま流用しない。GatewayのBeta機能を標準起動の必須条件にしない。

## 検証範囲

`tests/providers.test.ts` は実workerdでSDKを動かし、外部HTTPをすべてテスト内のfakeへ置き換える。Workers AIもfake bindingだけを渡す。許可一覧、未設定拒否、公開metadata、ローカル制約、各providerのリクエスト/レスポンス変換、固定応答と中断を対象にする。実Secret・有料推論・LM Studio実プロセス・Cloudflare上の実モデル接続はこのテストに含めない。実行結果は統合検証記録を参照する。

担当範囲の確認では32テストがローカルworkerdで成功し、TypeScript型検査も成功した。固定tool呼出し、未知tool・不正引数の実行拒否、SDKのstep上限も確認している。OpenRouterと推移依存のsourcemapに元ソース欠損の警告が出るが、テストの失敗ではない。後続の2026-09-29には、本人限定stagingの指定Workers AI FP8モデルで2回の実応答・SSE終端・完了前UI更新を確認した。終了後はAI bindingを外して無効化済み。他providerやモデルの実疎通は未検証で、今回の成功を流用しない。[実接続の範囲と結果](実AI接続-最小検証計画.md#修正版の実接続結果後処理中2026-09-29)を参照。

## 公式根拠

- [AI SDK provider一覧](https://ai-sdk.dev/providers/ai-sdk-providers)、[OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)、[Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)、[Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)
- [Workers AI SDK](https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/)、[Workers AIモデル例](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)、[Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)、[Claudeモデル](https://platform.claude.com/docs/en/models/overview)、[Googleモデル](https://ai.google.dev/gemini-api/docs/models)
- [OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider)、[OpenRouterモデル](https://openrouter.ai/openai/gpt-4.1-mini)、[LM Studio OpenAI互換API](https://lmstudio.ai/docs/developer/openai-compat)
- [AI Gateway OpenAI連携](https://developers.cloudflare.com/ai-gateway/usage/providers/openai/)

公開npmの指定版メタデータでNode/peer/licenseを確認した。AI SDK 7と各providerは `@ai-sdk/provider` 4.0.18の契約で連携する。実際の固定版はpackage/lockfileを正本とする。Workers AI providerのGateway delegateは別途Experimentalなので使用していない。
