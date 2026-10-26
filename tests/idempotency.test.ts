// The same key runs once; a failed run releases it; a run still in flight reports busy.
import "../scripts/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { closePools } from "../src/lib/db";
import { idempotent } from "../src/lib/idempotency";

after(() => closePools());

describe("idempotency keys", () => {
  test("a repeated key returns the first result and runs once", async () => {
    const key = randomUUID();
    let runs = 0;
    const first = await idempotent(key, "test", async () => (runs++, "/app/jobs/1"));
    const again = await idempotent(key, "test", async () => (runs++, "/app/jobs/2"));
    assert.deepEqual(first, { status: "ran", value: "/app/jobs/1" });
    assert.deepEqual(again, { status: "replayed", value: "/app/jobs/1" });
    assert.equal(runs, 1);
    assert.equal((await idempotent(key, "other-scope", async () => "x")).status, "ran", "keys are per scope");
  });

  test("a failure frees the key so a corrected retry goes through", async () => {
    const key = randomUUID();
    await assert.rejects(idempotent(key, "test", async () => { throw new Error("nope"); }), /nope/);
    assert.deepEqual(await idempotent(key, "test", async () => "fixed"), { status: "ran", value: "fixed" });
  });

  test("two at once: one runs, the other is told it is busy", async () => {
    const key = randomUUID();
    let release!: () => void;
    const slow = idempotent(key, "test", () => new Promise<string>((res) => (release = () => res("done"))));
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(await idempotent(key, "test", async () => "second"), { status: "busy" });
    release();
    assert.deepEqual(await slow, { status: "ran", value: "done" });
  });

  test("no key means no protection, and it just runs", async () => {
    let runs = 0;
    await idempotent(undefined, "test", async () => runs++);
    await idempotent(undefined, "test", async () => runs++);
    assert.equal(runs, 2);
  });
});
