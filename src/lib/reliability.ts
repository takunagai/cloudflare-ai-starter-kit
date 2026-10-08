// チャット要求の失敗分類と、ブラウザが再送前に照合する受付記録の型。
// 上流の生エラー・本文・資格情報を分類へ含めない。
export const FAILURE_MESSAGES: Record<string, string> = {
  request_preparation_failed:
    "回答の準備に失敗しました。回答モデルはまだ呼び出していません。要求の状態を確認してください。",
  request_not_found:
    "この要求の受付記録はまだ見つかりません。遅れて届く可能性があるため、新しい要求IDで再送せず再確認してください。",
  stream_interrupted:
    "回答の終了を確認できません。再送せず要求の状態と履歴を確認してください。",
  network_unconfirmed:
    "通信が途切れ、処理結果を確認できません。再送前に要求の状態を確認してください。",
  authentication_required:
    "ログインが必要です。再ログイン後に要求の状態を確認してください。",
  unexpected_response:
    "アプリの応答を確認できません。認証状態を確認し、送信済みの要求は状態を照合してください。",
  generation_failed:
    "回答生成が完了しませんでした。推論や課金が発生した可能性があります。再送前に要求の状態を確認してください。",
  generation_cancelled:
    "受信を中断しました。上流の処理や課金の取消しは保証されません。要求の状態を確認してください。",
  generation_timeout:
    "回答生成が時間制限に達しました。推論や課金が発生した可能性があります。",
  history_read_failed: "会話履歴を読み込めず、回答生成を開始しませんでした。",
  history_save_failed:
    "履歴の保存を確認できません。回答生成済みの可能性があるため、再送せず要求の状態を確認してください。",
  request_in_progress: "この要求は処理中です。再送せず状態を確認してください。",
  request_already_used:
    "この要求IDは使用済みです。履歴と要求の状態を確認してください。",
  request_id_conflict:
    "要求IDと送信内容が一致しません。新しい要求として再送せず、状態を確認してください。",
  local_recovery_unavailable:
    "ブラウザに要求IDを記録できないため送信を止めました。",
};
export function failureMessage(code: string) {
  return (
    FAILURE_MESSAGES[code] ??
    `処理を確認できませんでした（${/^[A-Za-z0-9_]{1,100}$/.test(code) ? code : "request_failed"}）。`
  );
}
export type RequestReceipt = {
  requestId: string;
  conversationId: string | null;
  status: string;
  failureCode: string | null;
  inference: "not_started" | "may_have_run" | "unknown";
  canRetry: boolean;
};
export type PendingRequest = { requestId: string; conversationId: string };
