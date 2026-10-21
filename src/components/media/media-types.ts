export type Asset = {
  id: string;
  source: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  duration: number | null;
  hasAlpha: boolean;
  state: string;
  expiresAt: number;
  isAvailable: boolean;
  canReference: boolean;
};
export type MediaModel = {
  id: string;
  hasAdapter: boolean;
  isExecutable: boolean;
};
export type Job = {
  id: string;
  model: string;
  providerState: string;
  collectionState: string;
  terminalAt: number | null;
  isCancellationRequested: boolean;
  isUncertain: boolean;
  isLegacy?: boolean;
  bodyAvailable?: boolean;
};
/** ジョブ・素材の状態の表示名。未知の値は呼出し側で「確認が必要」と表示する。 */
export const STATES: Record<string, string> = {
  reserved: "枠予約済み",
  submitting: "送信中",
  submission_unknown: "受付不明（再送しません）",
  queued: "待機中",
  running: "生成中",
  completed: "生成終了",
  failed: "失敗",
  cancelled: "停止確認済み",
  pending: "回収待ち",
  collecting: "回収中",
  collection_failed: "回収未完了",
  stored: "保存完了",
  invalid: "不正な出力",
  deleting: "削除待ち",
  discarded: "破棄確認済み",
  quarantined: "検証待ち",
  ready: "利用可能",
  deleted: "削除確認済み",
  legacy_external_url: "旧方式の外部保存",
};
