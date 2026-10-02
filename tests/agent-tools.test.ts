import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DraftApproval,
  decideNote,
  noteTools,
} from "../src/server/agent-tools";
import type { AppEnv, Identity } from "../src/server/env";

const local = { ...env, ENABLE_AGENT: "true" } as unknown as AppEnv;
const alice: Identity = {
  id: "test:alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = {
  id: "test:bob",
  email: "bob@example.test",
  name: "Bob",
};
const options = { toolCallId: "dummy-call", messages: [], context: {} };
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await local.DB.batch([
    local.DB.prepare("DELETE FROM tool_approvals"),
    local.DB.prepare("DELETE FROM notes"),
  ]);
});

describe("Human approval is the only note-saving boundary", () => {
  it("stores a proposal, rejects another user and saves exactly once on approval", async () => {
    const drafts: DraftApproval[] = [];
    const tools = noteTools(local, alice, (d) => drafts.push(d));
    await tools.draftNote.execute?.(
      { title: "Draft", content: "review first" },
      options,
    );
    expect(drafts).toHaveLength(1);
    expect(await local.DB.prepare("SELECT id FROM notes").first()).toBeNull();
    await expect(
      decideNote(local, bob, drafts[0].id, "approve"),
    ).rejects.toMatchObject({ status: 404 });
    expect(await decideNote(local, alice, drafts[0].id, "approve")).toEqual({
      status: "approved",
    });
    expect(await decideNote(local, alice, drafts[0].id, "approve")).toEqual({
      status: "approved",
    });
    expect(
      (
        await local.DB.prepare("SELECT count(*) AS n FROM notes").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });
  it("cannot save rejected or expired drafts", async () => {
    const drafts: DraftApproval[] = [];
    const tools = noteTools(local, alice, (d) => drafts.push(d));
    await tools.draftNote.execute?.({ title: "One", content: "one" }, options);
    await tools.draftNote.execute?.({ title: "Two", content: "two" }, options);
    await decideNote(local, alice, drafts[0].id, "reject");
    await expect(
      decideNote(local, alice, drafts[0].id, "approve"),
    ).rejects.toMatchObject({ status: 409 });
    await local.DB.prepare("UPDATE tool_approvals SET expires_at=0 WHERE id=?")
      .bind(drafts[1].id)
      .run();
    await expect(
      decideNote(local, alice, drafts[1].id, "approve"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await local.DB.prepare("SELECT id FROM notes").first()).toBeNull();
  });
  it("searches only owned notes and caps tool calls", async () => {
    await local.DB.batch([
      local.DB.prepare("INSERT INTO notes VALUES (?,?,?,?,?)").bind(
        "a",
        alice.id,
        "alpha",
        "private A",
        0,
      ),
      local.DB.prepare("INSERT INTO notes VALUES (?,?,?,?,?)").bind(
        "b",
        bob.id,
        "alpha",
        "private B",
        0,
      ),
    ]);
    const tools = noteTools(local, alice, () => {});
    const found = (await tools.searchNotes.execute?.(
      { query: "alpha" },
      options,
    )) as { notes: Array<{ id: string }> };
    expect(found.notes.map((note) => note.id)).toEqual(["a"]);
    for (let i = 0; i < 3; i++)
      await tools.searchNotes.execute?.({ query: "alpha" }, options);
    await expect(
      tools.searchNotes.execute?.({ query: "alpha" }, options),
    ).rejects.toMatchObject({ code: "tool_limit" });
  });
  it("racing opposite decisions cannot save a rejected note", async () => {
    let id = "";
    const tools = noteTools(local, alice, (d) => {
      id = d.id;
    });
    await tools.draftNote.execute?.(
      { title: "Race", content: "test" },
      options,
    );
    await Promise.allSettled([
      decideNote(local, alice, id, "reject"),
      decideNote(local, alice, id, "approve"),
    ]);
    const final = await local.DB.prepare(
      "SELECT status FROM tool_approvals WHERE id=?",
    )
      .bind(id)
      .first<{ status: string }>();
    const note = await local.DB.prepare("SELECT id FROM notes WHERE id=?")
      .bind(id)
      .first();
    expect(Boolean(note)).toBe(final?.status === "approved");
  });
  it("uses a single approval instant across the expiry boundary", async () => {
    let id = "";
    const tools = noteTools(local, alice, (d) => {
      id = d.id;
    });
    await tools.draftNote.execute?.(
      { title: "Boundary", content: "test" },
      options,
    );
    const cutoff = Date.now() + 1000;
    await local.DB.prepare("UPDATE tool_approvals SET expires_at=? WHERE id=?")
      .bind(cutoff, id)
      .run();
    let tick = cutoff;
    vi.spyOn(Date, "now").mockImplementation(() => tick++);
    expect(await decideNote(local, alice, id, "approve")).toEqual({
      status: "approved",
    });
    expect(
      await local.DB.prepare("SELECT id FROM notes WHERE id=?")
        .bind(id)
        .first(),
    ).toBeTruthy();
  });
});
