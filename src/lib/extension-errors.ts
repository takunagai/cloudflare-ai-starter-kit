// 任意拡張とmediaの固定エラーコードを、画面向けの説明へ変える。
// コードは診断用に括弧書きで残し、上流の生エラーや本文は含めない。
export const EXTENSION_FAILURE_MESSAGES: Record<string, string> = {
  feature_disabled: "この機能は無効になっています。",
  media_disabled: "画像・動画・音声の生成は無効になっています。",
  RAG_NOT_CONFIGURED:
    "資料機能の設定が済んでいません。管理者が保存先と検索の接続を設定するまで使えません。",
  WORKFLOWS_NOT_CONFIGURED:
    "長時間処理の設定が済んでいません。管理者がWorkflowの接続を設定するまで使えません。",
  IMAGES_NOT_CONFIGURED:
    "画像生成の設定が済んでいません。管理者が生成サービスの接続を設定するまで使えません。",
  billing_not_configured:
    "決済の設定が済んでいません。管理者が決済サービスの接続を設定するまで使えません。",
  media_not_configured:
    "生成サービスの接続が設定されていないため、生成できません。",
  media_storage_not_configured:
    "素材の保存先が設定されていないため、この機能は使えません。",
  media_configuration_invalid:
    "生成機能の設定に不整合があるため、停止しています。管理者に確認してください。",
  IMAGE_PROVIDER_UNAVAILABLE:
    "画像生成サービスに受け付けられたか確認できませんでした。同じ依頼を繰り返さず、一覧で状態を確認してください。",
  media_provider_unavailable:
    "生成サービスに接続できませんでした。時間をおいて状態を確認してください。",
  DOCUMENT_LIMIT_REACHED: "登録できる資料の上限に達しています。",
  RAG_SEARCH_LIMIT_REACHED: "資料検索の利用上限に達しています。",
  WORKFLOW_LIMIT_REACHED: "長時間処理の利用上限に達しています。",
  IMAGE_LIMIT_REACHED: "画像生成の利用上限に達しています。",
  MEDIA_LIMIT_REACHED: "生成の利用上限に達しています。",
  media_limit_reached:
    "生成の上限に達しています。処理中のジョブが終わるまで待ってください。",
};

export function extensionFailureMessage(code: string) {
  const safe = /^[A-Za-z0-9_]{1,100}$/.test(code) ? code : "request_failed";
  const message = EXTENSION_FAILURE_MESSAGES[safe];
  return message
    ? `${message}（${safe}）`
    : `処理できませんでした（${safe}）。`;
}
