# GitHub Actionsの固定版

確認日: 2026-09-27。

| 対象 | 公式情報 | 採用と制約 |
| --- | --- | --- |
| pnpm Action | [v6.1.0リリース](https://github.com/pnpm/action-setup/releases/tag/v6.1.0)はpnpm 12対応。[action.yml](https://github.com/pnpm/action-setup/blob/v6.1.0/action.yml)はNode.js 24で動作し、`run_install`入力を維持 | v6.1.0のコミット`0000000000000000000000000000000000000000`へ固定。アプリのNode.js 26.10.0とpnpm 12.6.0は変更しない |
| Ubuntu runner | [runner-imagesの一覧](https://github.com/actions/runner-images#available-images)に`ubuntu-24.04`がある。[移行告知](https://github.com/actions/runner-images/issues/14748)では`ubuntu-latest`が2026-10-19から26.04へ段階移行する | 検証済みの24.04へ固定し、意図しないOS変更を避ける。26.04への更新は別のCI実行で確認する |

CIは自動deployを含めず、pnpmのセットアップ、固定Node、frozen install、ローカル検証を実行する。Actionとrunnerの変更後はGitHub上の実行結果で確認する。


## 2026-09-28: 履歴整理と作者メール

GitHubのWeb操作とローカルGitで作者メールの設定が異なる。公式はWeb操作に対してSettings → Emails → Keep my email addresses privateを案内している。ローカルの匿名化だけではサーバー生成参照のメタデータを保証できないため、今回はPRなしのpush CIを採用した。メール非公開設定は本人が確認し、次回PRでは生成後のメタデータも検証する。アカウント全体の設定は未変更。

- https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address
- https://docs.github.com/en/account-and-profile/how-tos/email-preferences/blocking-command-line-pushes-that-expose-your-personal-email-address

後者は直近コミットのauthorメールを検査する仕組みであり、全履歴検査の代わりにはしない。
