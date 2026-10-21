import { api } from "../api-client";
import { type Job, STATES } from "./media-types";

/** 生成履歴。各操作は`run`経由で実行し、完了後の一覧更新も`run`に任せる。 */
export function JobHistory({
  jobs,
  isBusy,
  isEnabled,
  run,
  onNotice,
}: {
  jobs: Job[];
  isBusy: boolean;
  isEnabled: boolean;
  run: (operation: () => Promise<void>) => Promise<void>;
  onNotice: (notice: string) => void;
}) {
  return (
    <section>
      <h2>生成履歴</h2>
      {jobs.map((job) => (
        <article className="resource-card" key={job.id}>
          <p>{job.isLegacy ? "旧方式の画像" : job.model}</p>
          <p>
            {STATES[job.providerState] ?? "状態確認が必要"} ·{" "}
            {STATES[job.collectionState] ?? "回収確認が必要"}
            {job.isCancellationRequested ? " · 取消依頼済み" : ""}
          </p>
          {job.isUncertain && (
            <p className="app-notice">
              処理は未確定です。利用枠を保持しています。
            </p>
          )}
          <div className="button-row">
            {!job.isLegacy && (
              <>
                <button
                  type="button"
                  className="secondary"
                  disabled={isBusy || !isEnabled || job.terminalAt !== null}
                  onClick={() => {
                    void run(async () => {
                      await api(`/api/media/jobs/${job.id}/refresh`, {});
                    });
                  }}
                >
                  状態を確認
                </button>
                {job.collectionState === "collection_failed" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={isBusy || !isEnabled}
                    onClick={() => {
                      void run(async () => {
                        await api(
                          `/api/media/jobs/${job.id}/retry-collection`,
                          {},
                        );
                      });
                    }}
                  >
                    同じ結果の回収を再開
                  </button>
                )}
                {job.terminalAt === null && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={isBusy || job.isCancellationRequested}
                    onClick={() => {
                      void run(async () => {
                        await api(`/api/media/jobs/${job.id}/cancel`, {});
                      });
                    }}
                  >
                    取消を依頼
                  </button>
                )}
                <button
                  type="button"
                  className="link-button danger"
                  disabled={isBusy || !job.bodyAvailable}
                  onClick={() => {
                    void run(async () => {
                      await api(
                        `/api/media/jobs/${job.id}`,
                        undefined,
                        "DELETE",
                      );
                      onNotice(
                        "ジョブ本文を消去しました。重複防止の利用記録は保持します。",
                      );
                    });
                  }}
                >
                  ジョブ本文を消去
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      {!jobs.length && <p className="app-hint">生成履歴はまだありません。</p>}
      <button
        type="button"
        className="secondary"
        disabled={isBusy}
        onClick={() => {
          void run(async () => {});
        }}
      >
        素材・履歴を更新
      </button>
    </section>
  );
}
