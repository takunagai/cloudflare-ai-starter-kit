# モデル接続

確認日: 2026-09-27。AI SDK 7のproviderをサーバーで生成する。`listModels` は表示用のID・名称・provider・設定済みフラグだけを返し、`getModel` はコードにある許可一覧から選ぶ。ブラウザから任意のモデル名、endpoint、APIキーを受け付けない。

## 初期の許可一覧

2026-09-29の現在状態: 指定FP8は`7abc1696`で実接続2回・逐次表示を確認し、終了後はAI OFF・binding除去済み。後続依存修正版は未配備です。他provider・LM Studioは実接続未検証で、必要な用途だけ次に選びます。stagingは検証フラグOFFでも指定FP8/固定窓/総枠の制約を解除しません。[最終レビューと次の用途](main取り込み-最終レビューと次の用途.md)を参照してください。

以下の2026-09-28追記はモデル変更時点の履歴です。

2026-09-28追記: 廃止対象の旧Workers AIモデルをFP8版へ更新しました。公開IDも変更し、旧IDを別モデルへ転送しません。[最小検証計画](実AI接続-最小検証計画.md)と[制御の実装状況](実AI検証制御-実装状況.md)を参照してください。fakeによるローカル検証済み、実接続は未実施です。他providerの提供状況を今回一括再確認したという意味ではありません。

| 画面に渡すID | 接続先モデル | 必要なサーバー設定 |
| --- | --- | --- |
| `openai/gpt-4.1-mini` | `gpt-4.1-mini` / Chat Completions | `OPENAI_API_KEY` |
| `anthropic/claude-haiku-4-5` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| `google/gemini-3.5-flash-lite` | `gemini-3.5-flash-lite` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `workers-ai/llama-3.1-8b-fp8` | `@cf/meta/llama-3.1-8b-instruct-fp8` | Workers AI binding `AI`。stagingは検証設定・期限も必要 |
| `openrouter/openai/gpt-4.1-mini` | `openai/gpt-4.1-mini` | `OPENROUTER_API_KEY` |
| `lm-studio/local` | サーバー側の `LM_STUDIO_MODEL` | ローカル環境と `LM_STUDIO_BASE_URL` |
| `local/demo` | AIを使わない固定応答 | ローカル環境と `LOCAL_DEMO=true` |

`available` は設定が揃っているという意味。実際のキーの有効性、残高、モデルへのアクセス権、providerの稼働状況を照会した結果ではない。未設定モデルを選ぶと外部通信前に `ModelUnavailableError` になる。モデル一覧を取得するだけでは課金されない。

Googleの2.5系は確認時点で新規利用が制限されているため、新規プロジェクト向けとして公式が案内する3.5 Flash-Liteをサンプルにした。これは全モデルの性能・価格比較の結果ではない。利用モデルを追加・変更する場合は `src/server/ai/providers.ts` の許可一覧とadapterを変更し、テストと説明を更新する。無制限なモデルID入力や自動fallbackは導入していない。

## 導入手順

1. 対象環境と使うproviderを決める。機能が不要ならSecretやbindingを追加しない。
2. 外部モデルでは利用可能モデル・課金単位・入力/出力上限・予算をproviderの管理画面と公式料金表で確認する。Workers有料プランの月額に他社モデルの料金は含まれない。
3. Secretはユーザーが会話外で対象環境へ投入する。[Secrets運用補足](../rules/secrets.md) に従い、値をチャット・コマンド引数・ログに出さない。Workers AIは各環境へ `AI` bindingを個別に設定する。
4. モデル一覧で設定済みのモデルを選び、承認した回数・予算内の小さなリクエストで実接続を確認する。設定済み表示だけで実接続成功と扱わない。
5. API側で利用者の認証・利用枠・履歴所有権を確認し、`streamText` / `generateText` へ出力上限、timeout、retry回数を渡す。providerの生エラーにはリクエスト情報が含まれ得るため、HTTP応答やログへ丸ごと返さない。

料金は可変なのでコードに単価を埋め込まない。既定allowlistでも無課金を保証しない。アプリの回数/文字数/token上限は支出額そのものではないため、provider側の予算制限も併用する。キーがない場合に別providerへ自動転送することはない。

## ローカル動作確認

`APP_ENV=local` とloopbackの `APP_ORIGIN`、`LOCAL_DEMO=true` が揃った場合のみ、`local/demo` を有効にする。画面上の名称と応答本文の両方へ「AI未使用」と表示する。固定文を返し、ユーザー入力を反射せず、外部通信・課金を行わない。テキスト生成とstreamingの両方を確認できるが、実モデルの推論品質やtool選択の検証にはならない。

エージェント拡張で `draftNote` が渡された場合は、固定の「ローカル確認用下書き・AI未使用」を一度だけ提案し、次のstepで固定応答を返す。承認・保存は通常のAPIを通るため、人間の承認なしでメモを保存しない。この動作はtoolの接続確認用であり、AIによるtool選択ではない。

staging/productionではdemoとLM Studioを無効化する。API入口でも実リクエストの宛先がloopbackか確認し、local設定のまま公開された場合は拒否する。ローカルフラグを公開環境の設定へコピーしない。

## LM Studio

1. 開発PCでLM Studioのローカルサーバーを起動し、使用するモデルをロードする。外部公開やTunnelは不要。
2. サーバー設定に `LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1` と、ロードしたモデルの識別子を `LM_STUDIO_MODEL` として設定する。これらはモデル名/ローカルURLでありSecretではない。エージェントは実環境一覧を表示せず、設定はユーザーが行う。
3. `APP_ENV=local` とloopbackの `APP_ORIGIN` でアプリを起動し、`lm-studio/local` を選ぶ。LM Studioのモデル名はブラウザから自由指定できない。

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
