import assert from "node:assert/strict";
import test from "node:test";

import { createUploadQueue } from "../dist/index.js";

function createQueue() {
  let nextId = 0;
  return createUploadQueue({
    adapter: {
      prepare: async (_task, context) => {
        context.reportProgress(0.5);
        return "prepared";
      },
      upload: async () => "uploaded",
      commit: async () => ({ driveId: "drive-id" }),
    },
    createId: () => `task-${++nextId}`,
  });
}

test("enqueue creates an immutable waiting task snapshot", () => {
  const queue = createQueue();
  const id = queue.enqueue("source", {
    name: "report.pdf",
    size: 42,
    mimeType: "application/pdf",
    metadata: { folderId: "folder-1" },
  });

  assert.equal(id, "task-1");
  const snapshot = queue.getSnapshot();
  const task = snapshot.tasks[0]!;
  assert.equal(snapshot.running, false);
  assert.equal(task.status, "waiting");
  assert.equal(task.progress, 0);
  assert.equal(task.attempts, 0);
  assert.deepEqual(task.metadata, { folderId: "folder-1" });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.tasks), true);
  assert.equal(Object.isFrozen(task), true);
  assert.throws(() => {
    (task as { status: string }).status = "complete";
  }, TypeError);
  assert.equal(queue.getTask(id)?.status, "waiting");
});

test("subscribers receive the current snapshot and subsequent updates", () => {
  const queue = createQueue();
  const taskCounts: number[] = [];
  const unsubscribe = queue.subscribe((snapshot) => {
    taskCounts.push(snapshot.tasks.length);
  });
  queue.enqueue("one", { name: "one.txt" });
  queue.enqueue("two", { name: "two.txt" });
  unsubscribe();
  queue.enqueue("three", { name: "three.txt" });

  assert.deepEqual(taskCounts, [0, 1, 2]);
});

test("subscriber failures do not interrupt queue state changes", () => {
  const queue = createQueue();
  assert.doesNotThrow(() =>
    queue.subscribe(() => {
      throw new Error("render failed");
    }),
  );
  assert.doesNotThrow(() => queue.enqueue("source", { name: "file.txt" }));
  assert.equal(queue.getSnapshot().tasks.length, 1);
});

test("enqueue rejects invalid and duplicate task details", () => {
  const queue = createQueue();
  assert.throws(() => queue.enqueue("source", { name: " " }), /name/);
  assert.throws(
    () => queue.enqueue("source", { name: "file", size: -1 }),
    /size/,
  );
  queue.enqueue("source", { id: "stable", name: "file" });
  assert.throws(
    () => queue.enqueue("source", { id: "stable", name: "file" }),
    /Duplicate/,
  );
});
