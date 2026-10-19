# compatibility_dateの更新（2026-09-25 → 2026-10-12）

確認日: 2026-10-19。2026-10-18の依存一括更新（[記録](dependency-update-20261018.md)）で見送った`compatibility_date`を、同梱workerdの上限まで上げた。脆弱性修正ではない。

## 1. 採用日付と根拠

| 項目 | 内容 | 根拠 |
| --- | --- | --- |
| 同梱workerd | 1.20261012.1 | wrangler 4.151.1、@cloudflare/vite-plugin 1.64.0、@cloudflare/vitest-plugin 1.4.4（miniflare 5.20261012.x）がすべてこの版に依存（lockfileとnode_modulesのpackage.jsonで確認） |
| workerdの対応上限 | `2026-10-12` | workerd 1.20261012.1の`lib/main.js`が公開する`compatibilityDate` |
| 採用日付 | `2026-10-12` | 上限と同じ。wranglerの更新は不要 |

## 2. 2026-09-26〜2026-10-12に既定で有効になるフラグ

正本はworkerdソースの[`src/workerd/io/compatibility-date.capnp`](https://github.com/cloudflare/workerd/blob/v1.20261012.1/src/workerd/io/compatibility-date.capnp)（v1.20261012.1、`$compatEnableDate`と`$impliedByAfterDate`を全行検索）。公式の[Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)とも突き合わせた。

| フラグ | 有効日 | 変更内容 | このアプリへの影響 |
| --- | --- | --- | --- |
| `durable_object_io_tasks_prevent_eviction` | 2026-10-01 | Durable Objectの未完了タスク（`waitUntil`等）が、接続クライアントがなくても最大15分evictを防ぐ | なし。`wrangler.jsonc`に`durable_objects`がなく、`src/`・`tests/`・`vite.config.ts`・`build-policy.ts`に`DurableObject`の使用は0件。`waitUntil`はWorker側だけで使う |

- 範囲内で`$impliedByAfterDate`により有効になるフラグ（`nodejs_compat`由来を含む）は0件。
- capnpに2026-10-13以降の有効日を持つフラグはない。
- `compatibility_flags`（`["nodejs_compat"]`）は変更しない。

将来Durable Object（Agents SDK等）を追加する複製先では、上記フラグの挙動が既定になる。

## 3. 変更内容

- `wrangler.jsonc`の`compatibility_date`だけを変更。`pnpm typecheck`で再生成される生成物に追跡対象の差分はなかった。
- `scripts/archive/`の旧設定例と、過去の検証記録にある`2026-09-25`は当時の記録として残す。

## 4. 検証（ローカル、2026-10-19）

| 検証 | 更新前 | 更新後 |
| --- | --- | --- |
| `pnpm check` | exit 0（45ファイル879件、build fixture 7件） | exit 0（45ファイル879件、build fixture 7件） |
| `pnpm preview`＋`pnpm smoke` | ─ | HTTP smoke・app smokeともPASS（exit 0） |

GitHub CI、実環境への配備、複製先への反映は未実施。実行時の挙動差は上記フラグの判断とローカル検証によるもので、本番で実測していない。
