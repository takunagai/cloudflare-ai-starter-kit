import { env } from "cloudflare:workers";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { authSchema } from "../src/server/db/auth-schema";
import type { AppEnv } from "../src/server/env";

const db = (env as unknown as AppEnv).DB;

describe("Applied D1 auth migration matches Drizzle", () => {
  for (const table of Object.values(authSchema)) {
    const config = getTableConfig(table);
    it(`matches columns and required constraints for ${config.name}`, async () => {
      // テーブル名は静的schema由来のみ。外部入力からSQL識別子を組み立てない。
      const actual = await db
        .prepare(`PRAGMA table_info(${config.name})`)
        .all<{ name: string; type: string; notnull: number; pk: number }>();
      const expected = config.columns.map((column) => ({
        name: column.name,
        type: column.getSQLType().toUpperCase(),
        notnull: Number(column.notNull),
        pk: Number(column.primary),
      }));
      expect(
        actual.results.map(({ name, type, notnull, pk }) => ({
          name,
          type,
          notnull,
          pk,
        })),
      ).toEqual(expected);
      const indexes = await db
        .prepare(`PRAGMA index_list(${config.name})`)
        .all<{ name: string; unique: number }>();
      const declaredUniqueColumns = config.columns
        .filter((column) => column.isUnique)
        .map((column) => column.name);
      const indexedColumns: string[][] = [];
      for (const index of indexes.results.filter((entry) => entry.unique)) {
        const columns = await db
          .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
          .bind(index.name)
          .all<{ name: string }>();
        indexedColumns.push(columns.results.map((column) => column.name));
      }
      for (const column of declaredUniqueColumns)
        expect(indexedColumns).toContainEqual([column]);
      for (const index of config.indexes) {
        expect(
          indexes.results.some(
            (entry) =>
              entry.name === index.config.name &&
              entry.unique === Number(index.config.unique),
          ),
        ).toBe(true);
      }
    });
  }
});
