# GitHubメール設定とPR参照の公式調査

確認日: 2026-09-28。公式仕様、プロジェクトの運用判断、本人設定の確認結果を区別する。実メール・アカウントID・個別管理URLは記録しない。

| 公式資料 | 確認した仕様 | 採用判断・制約 |
| --- | --- | --- |
| [コミットメールの設定](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address) | Web操作のメール非公開を有効にすると作者メールはnoreplyになる。ローカルGitは別設定で、repo-local設定はglobalを上書きする。変更は既存コミットのメールを書き換えない | Web設定は本人が確認・変更する。ローカルは既存匿名設定をこのrepoだけに適用し、globalの変更はしない |
| [メールを露出するCLI pushの防止](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/blocking-command-line-pushes-that-expose-your-personal-email-address) | 最新コミットのauthorがアカウントの非公開メールならpushを拒否する | 本人に有効化を案内する。全履歴・committerの検査を代行すると解釈しない |
| [メール仕様](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference) | GitHubのnoreplyにはユーザー名を含む形式と、ID・ユーザー名を含む形式がある | noreplyでも完全匿名ではない。個人メールと公開ユーザー識別を区別し、作者名の公開可否も確認する。値は記録しない |
| [PR取得API](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request) | GitHubはmerge可否確認用の仮マージを生成する。head／baseへは追加されず、生成は非同期になり得る。未merge時のmerge_commit_shaは仮マージを指し、通常merge後は実際のmergeコミットを指す | PR作成後にhead／仮マージを取得・検査する。merge後は実mergeとmainを再取得し、先端・親・本文・作者情報を別に検査する。未生成や検査不能は完了扱いにしない |
| [PRのmerge方式](https://docs.github.com/en/pull-requests/reference/pull-request-merges) | 通常のmerge commitはPR内の各コミットを保持する | 本人が許可したPR #1は通常mergeを採用し、元の18コミットがmainへ保持されたことを確認。履歴整理やsquash／rebaseは今回の操作に含めない |
| [PRのmerge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request) | 確認済みheadのSHAを一致条件として指定できる | headの一致条件を付けてPR #1をmerge。ローカルのCLIヘルプでも対応するオプションを確認し、管理者権限による保護の迂回は行わない |

以前の仮マージの非公開メール候補について、特定のアカウント設定が原因だと確定できる根拠は得ていない。メール設定だけで全経路を安全と断定せず、サーバー生成後にも別検査する。

本人の設定確認結果、ローカル検査、GitHub取得・生成メタデータ、CIの実行結果は[設定メモ](../docs/リポジトリ-公開情報と履歴管理.md)と[作業ログ](../docs/archive/staging-work-log.md)を参照する。共通フックによる本文の形式検査は、公開可否の判断や作者メタデータの検査の代わりにしない。
