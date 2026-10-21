import {
  failureMessage,
  type PendingRequest,
  type RequestReceipt,
} from "../../lib/reliability";

/** 前の要求の結果が不明なとき、再送の前に台帳と履歴を照合させる。 */
export function RequestRecoveryCard({
  pending,
  receipt,
  isChecking,
  onReconcile,
  onResume,
}: {
  pending: PendingRequest;
  receipt: RequestReceipt | null;
  isChecking: boolean;
  onReconcile: () => void;
  onResume: () => void;
}) {
  return (
    <section className="resource-card" aria-label="送信結果の確認">
      <h2>再送前に、前の要求を確認してください</h2>
      <p>要求ID：{pending.requestId}</p>
      <p>確認は保存済み台帳と履歴だけを読みます。回答生成は行いません。</p>
      {receipt && (
        <p>
          {receipt.status === "pending"
            ? "処理中です。時間を置いて確認してください。"
            : receipt.canRetry
              ? "推論開始前の失敗を確認しました。"
              : "処理結果または課金が不明です。新しい要求として再送しないでください。"}
        </p>
      )}
      {receipt?.failureCode && <p>{failureMessage(receipt.failureCode)}</p>}
      <button type="button" disabled={isChecking} onClick={onReconcile}>
        要求の状態と履歴を確認
      </button>
      {receipt?.canRetry && receipt.requestId === pending.requestId && (
        <button type="button" onClick={onResume}>
          推論前の失敗を確認して、入力を再開
        </button>
      )}
    </section>
  );
}
