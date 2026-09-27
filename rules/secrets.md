# Cloudflareスターター固有のSecrets運用補足

更新日: 2026-09-27。全プロジェクト共通の秘密保護はユーザーレベルで管理する。このファイルはアプリ固有の補足だけを扱い、個人設定の全文コピーや所有者固有の絶対パスを含めない。

- 第1段階ではSecret不要。第2段階で機能ごとにキー名・用途・対象環境・必要権限を確定する。任意拡張OFF時はそのSecretを要求しない。
- ローカルは`.dev.vars`または`.env`の利用方式と環境別の読み込み優先順位を決める。実値はユーザーが会話外で投入し、例はダミー値のみとする。
- 本番はWorkers Secretsを使用し、`wrangler.jsonc`の`vars`やブラウザ公開変数へ秘密を置かない。local/staging/productionで資格情報とリソースを分離する。
- `wrangler secret put`は新version作成と即時deployを伴う。対象環境と影響を確定し、承認済みの範囲でユーザーによる対話入力を案内する。
- version作成と配備を分ける場合は`wrangler versions secret`を検討する。build時の環境と生成設定を対応させ、展開済み設定へ`--env`を重ねない。詳細は [運用手順](../docs/operations.md)。
- 設定確認・疎通は実Secretを表示せず行う。通常CIには実LLM・メール・決済用の資格情報を与えない。
- 共通ルールの正本は`~/.claude/rules/env-inspection.md`と`secret-injection.md`。CodexもユーザーレベルのAGENTS.mdから参照する。別マシン・別ユーザーの複製先には個人設定が自動配布されないため、その環境で同等のルールと保護を用意する。

公式確認日: 2026-09-27。[Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)。記載は仕様・方針であり、Secret投入やdeployの実行許可ではない。
