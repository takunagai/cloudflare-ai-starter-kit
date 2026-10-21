import { type Asset, STATES } from "./media-types";

/** 自分の素材。参照・開始画像への指定と削除は呼出し元が状態と合わせて処理する。 */
export function AssetList({
  assets,
  references,
  isBusy,
  isEnabled,
  onVideoStart,
  onReference,
  onDelete,
}: {
  assets: Asset[];
  references: string[];
  isBusy: boolean;
  isEnabled: boolean;
  onVideoStart: (id: string) => void;
  onReference: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section>
      <h2>自分の素材</h2>
      <div className="resource-cards">
        {assets.map((asset) => (
          <article className="resource-card" key={asset.id}>
            {asset.isAvailable && asset.format === "mp4" && (
              <video
                className="generated-image"
                controls
                preload="metadata"
                src={`/api/media/assets/${asset.id}/file`}
                aria-label="生成した動画"
              >
                <track kind="captions" />
              </video>
            )}
            {asset.isAvailable && ["wav", "mp3"].includes(asset.format) && (
              <audio
                controls
                preload="metadata"
                src={`/api/media/assets/${asset.id}/file`}
                aria-label="生成した音声"
              >
                <track kind="captions" />
              </audio>
            )}
            {asset.isAvailable &&
              ["png", "jpeg", "webp"].includes(asset.format) && (
                <img
                  className="generated-image"
                  src={`/api/media/assets/${asset.id}/file`}
                  alt={
                    asset.source === "result"
                      ? "生成した画像"
                      : "アップロードした参照画像"
                  }
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
            <p>
              {asset.format === "mp4"
                ? "生成動画"
                : ["wav", "mp3"].includes(asset.format)
                  ? "生成音声"
                  : asset.source === "result"
                    ? "生成画像"
                    : "参照画像"}{" "}
              · {asset.format.toUpperCase()}{" "}
              {asset.width && asset.height
                ? ` · ${asset.width} × ${asset.height}`
                : ""}
              {asset.duration !== null && ` · ${asset.duration.toFixed(2)}秒`}
            </p>
            <p>
              {asset.expiresAt <= Date.now()
                ? "期限切れ"
                : (STATES[asset.state] ?? "確認待ち")}{" "}
              · 期限 {new Date(asset.expiresAt).toLocaleString("ja-JP")}
            </p>
            {!asset.canReference &&
              ["png", "jpeg", "webp"].includes(asset.format) && (
                <p className="app-hint">
                  {!asset.isAvailable
                    ? "期限・削除・検証状態により利用できません。"
                    : "参照画像の容量・寸法上限を超えています。保存用として取得できます。"}
                </p>
              )}
            <div className="button-row">
              {["png", "jpeg", "webp"].includes(asset.format) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    isBusy ||
                    !isEnabled ||
                    !asset.canReference ||
                    asset.expiresAt < Date.now() + 1800000
                  }
                  onClick={() => onVideoStart(asset.id)}
                >
                  動画の開始画像に使う
                </button>
              )}
              <button
                type="button"
                className="secondary"
                disabled={
                  isBusy ||
                  !isEnabled ||
                  !asset.canReference ||
                  references.includes(asset.id) ||
                  references.length >= 8 ||
                  asset.expiresAt < Date.now() + 1_800_000
                }
                onClick={() => onReference(asset.id)}
              >
                編集の参照に使う
              </button>
              {asset.isAvailable && (
                <a
                  href={`/api/media/assets/${asset.id}/file`}
                  download={`media.${asset.format}`}
                >
                  {asset.format === "mp4"
                    ? "動画を保存"
                    : ["wav", "mp3"].includes(asset.format)
                      ? "音声を保存"
                      : "画像を保存"}
                </a>
              )}
              <button
                type="button"
                className="link-button danger"
                disabled={isBusy}
                onClick={() => onDelete(asset.id)}
              >
                削除
              </button>
            </div>
          </article>
        ))}
      </div>
      {!assets.length && <p className="app-hint">素材はまだありません。</p>}
    </section>
  );
}
