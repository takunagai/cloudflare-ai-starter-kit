# モデル接続

AI SDK 7のproviderをサーバーで生成する。`src/server/ai/catalog.ts`が公開モデルの定義と設定判定の正本、`providers.ts`がadapterで、ブラウザから任意のモデル名・endpoint・APIキーは受け付けない。`listModels`は表示用のID・名称・provider・設定済みフラグだけを返し、`getModel`はコードにある許可一覧から選ぶ。固定版は`package.json`とlockfileを正本とする。

Jevは本書のチャット一覧に混ぜず、専用の`JEV_MODE`で独立して制御する。契約は[Jev契約](Jev-B3J-実装前契約.md)、設定の判定は[実行時方針](runtime-policy.md)を参照。

## 公開モデルの一覧

| 画面に渡すID | 接続先モデル | 必要なサーバー設定 |
| --- | --- | --- |
| `openai/gpt-4.1-mini` | `gpt-4.1-mini` / Chat Completions | `OPENAI_API_KEY` |
| `anthropic/claude-haiku-4-5` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| `google/gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `workers-ai/llama-3.1-8b-fp8` | `@cf/meta/llama-3.1-8b-instruct-fp8` | Workers AI binding `AI` |
| `openrouter/openai/gpt-4.1-mini` | `openai/gpt-4.1-mini` | `OPENROUTER_API_KEY` |
| `lm-studio/local` | サーバー側の `LM_STUDIO_MODEL` | ローカル環境と `LM_STUDIO_BASE_URL` |
| `local/demo` | AIを使わない固定応答 | ローカル環境と `LOCAL_DEMO=true` |

旧Workers AIモデルは公式の廃止対象のためFP8版へ更新した。旧IDを別モデルへ転送しない。モデルを追加・変更するときは`catalog.ts`の公開定義と`providers.ts`のadapterを変更し、選択と直接取得の契約テストと本書を更新する。無制限なモデルID入力と自動fallbackは導入しない。サンプルのモデルは性能・価格比較の結果ではなく、提供継続・権限・料金は導入時に再確認する。

## 選択と可用性

- チャットで使えるモデルは`AI_MODE`と`AI_ALLOWED_MODELS`で明示する。資格情報やbindingがあるだけでは有効にならない。省略時にdemoになるのは、loopbackのlocalで`LOCAL_DEMO=true`のときだけで、ほかはOFF。設定値の規則と拒否コードは[実行時方針](runtime-policy.md)にある。
- `getModel`と同期の`listModels`は設定の選択と充足だけを見て、DBは読まない。認証済みの`/api/models`は、さらに通常stagingの台帳確認を通した結果を`available`として返し、不適合なら全件`available:false`にする。チャットの受付・予約・各モデルstepの直前とWorkflowの推論stepも同じガードを通す。
- 選択外の既知モデルは503、未知のIDは有効なチャットポリシーのもとで400。選択外や未設定のadapterは外部通信の前に`ModelUnavailableError`になる。
- `available`はキーの有効性・残高・実利用権限・provider稼働を照会した結果ではない。モデル一覧は推論しない。
- `STAGING_POLICY`を省略したstagingは、モデルを全件`available:false`にする。

## 導入手順

選んだ接続を準備する順序。4〜5の実設定と実接続は別承認の後に行う。

1. [用途別入口](../README.md#用途を選んで始める)から環境・認証を選ぶ。localの固定応答、または非localのAI OFFのまま準備でき、不要なproviderのSecret/bindingは追加しない。
2. チャットは`AI_MODE=selected`、`LOCAL_DEMO="false"`、`AI_ALLOWED_MODELS`にこの一覧の公開IDだけを非空のJSON配列で明示する。`local/demo`・Jev・falは混ぜない。AI OFFとdemoでは`LOCAL_DEMO`を明示し、`AI_ALLOWED_MODELS`は省略か`[]`だけ。
3. [実接続前の停止条件](operations.md#実接続前の停止条件)で、提供継続・実権限・課金単位・保持/削除・人数・共有利用・総予算・期間・終了操作を確認する。Workers有料プランの月額に他社モデルの料金は含まれない。
4. 別承認の後に、ユーザーが会話外で対象環境のSecretを投入する。[Secrets運用補足](../rules/secrets.md)に従い、値をチャット・コマンド引数・ログに出さない。Workers AIは各環境へ`AI` bindingを個別に設定する。build/配備先は[buildの選択と拒否](公開プリセットとbuild境界.md#buildの選択と拒否)に従う。
5. 認証済みのモデル一覧で選択と設定充足を確認し、承認した回数・予算・期間内の小さなリクエストで実接続する。実行時も認証・所有権・原子的枠・台帳・モデル選択を再確認し、出力上限・timeout・retry 0を維持する。生エラーをHTTPやログへ返さない。

fal等の拡張は対応する`ENABLE_*`で独立して制御する。`AI_MODE`だけで実メール・Jev・画像・決済の全接続を止められるとは言えないので、終了操作は接続ごとに定義する。

料金は可変なのでコードに単価を埋め込まない。既定のallowlistでも無課金は保証しない。アプリの回数・文字数・token上限は支出額そのものではないため、provider側の予算制限も併用する。キーがない場合に別providerへ自動転送することはない。

## ローカル動作確認

`APP_ENV=local`とloopbackの`APP_ORIGIN`、`LOCAL_DEMO=true`が揃った場合のみ`local/demo`を有効にする。画面上の名称と応答本文の両方に「AI未使用」と表示する。固定文を返し、ユーザー入力を反射せず、外部通信・課金を行わない。テキスト生成とstreamingの両方を確認できるが、実モデルの推論品質やtool選択の検証にはならない。

エージェント拡張で`draftNote`が渡された場合は、固定の「ローカル確認用下書き・AI未使用」を一度だけ提案し、次のstepで固定応答を返す。承認と保存は通常のAPIを通るため、人間の承認なしでメモを保存しない。この動作はtoolの接続確認用で、AIによるtool選択ではない。

staging/productionではdemoとLM Studioを無効化する。API入口でも実リクエストの宛先がloopbackかを確認し、local設定のまま公開された場合は拒否する。ローカルのフラグを公開環境の設定へコピーしない。

## LM Studio

1. 開発PCでLM Studioのローカルサーバーを起動し、使用するモデルをロードする。外部公開やTunnelは不要。
2. サーバー設定に`LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1`と、ロードしたモデルの識別子を`LM_STUDIO_MODEL`として設定する。これらはモデル名とローカルURLでSecretではない。エージェントは実環境の一覧を表示せず、設定はユーザーが行う。
3. 別選択として`APP_ENV=local`とloopbackの`APP_ORIGIN`、`LOCAL_DEMO="false"`、`AI_MODE=selected`、`AI_ALLOWED_MODELS='["lm-studio/local"]'`を明示する。既定のdemoから自動接続しない。
4. そのlocal対象で起動して`lm-studio/local`を選び、実プロセスとの疎通を確認する。LM Studioのモデル名はブラウザから自由に指定できない。固定応答の試験やfakeテストは、LM Studioの実疎通の証拠ではない。

接続先はHTTPの`localhost` / `127.0.0.1` / `[::1]`と`/v1`に限定する。userinfo・query・fragmentや外部ホストは拒否し、HTTP redirectも追わない。クラウドWorkerのlocalhostは開発PCを指さないため、クラウドからの接続はサポートしない。ローカルサーバー側で追加認証を要求する設定は、このサンプルの対象外。

## AI Gateway（任意の運用拡張）

標準は各providerへの直接接続で、Gateway設定を要求しない。導入する場合はCloudflareで専用Gatewayを用意し、ログ保存とデータ取り扱い、追加の認証、予算制御の仕様を確認する。例えばOpenAI providerのサーバー側`baseURL`を`https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway-id>/openai`へ向ける方法がある。実際のIDやSecretをコードへ埋め込まず、固定した環境設定として扱う。動的なクライアントURLは許可しない。

この接続例は現行コードで有効になっていない。導入時はproviderのURL・認証方式・レスポンス互換性を検証し、他providerへ設定をそのまま流用しない。GatewayのBeta機能を標準起動の必須条件にしない。Workers AI providerのGateway delegateはExperimentalなので使用していない。

## 検証範囲

`tests/providers.test.ts`は実workerdでSDKを動かし、外部HTTPをすべてテスト内のfakeへ置き換える。Workers AIもfake bindingだけを渡す。許可一覧、未設定の拒否、公開metadata、ローカル制約、各providerのリクエスト/レスポンス変換、固定応答、中断を対象にする。固定tool呼出し、未知toolと不正引数の実行拒否、SDKのstep上限も確認する。実Secret・有料推論・LM Studioの実プロセス・Cloudflare上の実モデル接続はこのテストに含めない。

実接続で確認した範囲は、2026-09-29に旧stagingでWorkers AIの指定FP8モデルを2回呼び、逐次表示と履歴の保存・復元・削除を確認したものだけ（記録は[実AI接続の検証計画](archive/実AI接続-最小検証計画.md)）。その環境は削除済みで、他providerとモデルの実疎通は未検証。

## 公式根拠

- [AI SDK provider一覧](https://ai-sdk.dev/providers/ai-sdk-providers)、[OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai)、[Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)、[Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)
- [Workers AI SDK](https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/)、[Workers AIモデル例](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)、[Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)、[Claudeモデル](https://platform.claude.com/docs/en/models/overview)、[Googleモデル](https://ai.google.dev/gemini-api/docs/models)
- [OpenRouter provider](https://github.com/OpenRouterTeam/ai-sdk-provider)、[OpenRouterモデル](https://openrouter.ai/openai/gpt-4.1-mini)、[LM Studio OpenAI互換API](https://lmstudio.ai/docs/developer/openai-compat)
- [AI Gateway OpenAI連携](https://developers.cloudflare.com/ai-gateway/usage/providers/openai/)
