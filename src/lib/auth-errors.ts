// ログイン・登録・パスワード再設定・確認メールの固定エラーコードを、画面向けの説明へ変える。
// コードは診断用に括弧書きで残す。Better Authの英語messageは表示しない。
// 存在しないアカウントと誤パスワードはBetter Authが同じコードで返す。区別する文言を足さない。
export const AUTH_FAILURE_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "メールアドレスまたはパスワードが違います。",
  EMAIL_NOT_VERIFIED:
    "メールアドレスの確認が済んでいません。届いた確認メールのリンクを開いてから、もう一度ログインしてください。",
  // メール確認なしの設定（ローカル）でだけ返る。本番は新規登録と同じ応答になる。
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "このメールアドレスは登録済みです。ログインするか、パスワードを再設定してください。",
  PASSWORD_TOO_SHORT: "パスワードが短すぎます。12文字以上で入力してください。",
  PASSWORD_TOO_LONG: "パスワードが長すぎます。128文字以内で入力してください。",
  INVALID_EMAIL: "メールアドレスの形式が正しくありません。",
  VALIDATION_ERROR: "入力内容を確認してください。",
  INVALID_TOKEN:
    "再設定リンクが無効か、期限が切れています。もう一度再設定メールを送ってください。",
  reset_link_required:
    "再設定リンクが見つかりません。メールのリンクから開き直してください。",
  rate_limited:
    "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。",
  email_not_configured:
    "メール送信が設定されていないため、この操作は使えません。",
  auth_unavailable:
    "認証サービスを利用できませんでした。時間をおいてもう一度お試しください。",
  INVALID_ORIGIN: "このページの接続元が許可されていません。",
  MISSING_OR_NULL_ORIGIN: "このページの接続元が許可されていません。",
  PROVIDER_NOT_FOUND: "Googleでのログインは設定されていません。",
  invalid_login_redirect:
    "ログイン先を確認できなかったため、移動を中止しました。",
  network_unconfirmed:
    "通信が途中で切れました。時間をおいてもう一度お試しください。",
  unexpected_response:
    "予期しない応答を受け取りました。時間をおいてもう一度お試しください。",
};

export function authFailureMessage(code: string) {
  const safe = /^[A-Za-z0-9_]{1,100}$/.test(code) ? code : "request_failed";
  const message = AUTH_FAILURE_MESSAGES[safe];
  return message
    ? `${message}（${safe}）`
    : `処理できませんでした（${safe}）。`;
}
