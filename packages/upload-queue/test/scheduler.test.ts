import assert from "node:assert/strict";
import test from "node:test";

import { createUploadQueue } from "../dist/index.js";
import { deferred, delay, waitForSnapshot, waitForStatus } from "./helpers.ts";

test("respects the configured task concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  const queue = createUploadQueue({
    concurrency: 2,
    adapter: {
      prepare: async (_task) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await delay(20);
        active -= 1;
        return "prepared";
      },
      upload: async () => "uploaded",
      commit: async () => "done",
    },
  });
  const ids = [
    queue.enqueue("one", { name: "one" }),
    queue.enqueue("two", { name: "two" }),
    queue.enqueue("three", { name: "three" }),
    queue.enqueue("four", { name: "four" }),
  ];
  queue.start();
  await waitForSnapshot(
    queue,
    (snapshot) => snapshot.tasks.every((task) => task.status === "complete"),
  );

  assert.equal(maximumActive, 2);
  assert.equal(ids.every((id) => queue.getTask(id)?.status === "complete"), true);
});

test("serializeCommit prevents overlapping commits", async () => {
  let activeCommits = 0;
  let maximumCommits = 0;
  const queue = createUploadQueue({
    concurrency: 3,
    serializeCommit: true,
    adapter: {
      prepare: async () => "prepared",
      upload: async (_task) => "uploaded",
      commit: async () => {
        activeCommits += 1;
        maximumCommits = Math.max(maximumCommits, activeCommits);
        await delay(15);
        activeCommits -= 1;
        return "done";
      },
    },
  });
  for (let index = 0; index < 3; index += 1) {
    queue.enqueue(index, { name: `file-${index}` });
  }
  queue.start();
  await waitForSnapshot(
    queue,
    (snapshot) => snapshot.tasks.every((task) => task.status === "complete"),
  );
  assert.equal(maximumCommits, 1);
});

test("commit keys serialize each vault independently", async () => {
  let activeCommits = 0;
  let maximumCommits = 0;
  const queue = createUploadQueue({
    concurrency: 4,
    serializeCommit: true,
    getCommitKey: (task) => task.metadata?.vaultId ?? "unknown",
    adapter: {
      prepare: async () => "prepared",
      upload: async () => "uploaded",
      commit: async () => {
        activeCommits += 1;
        maximumCommits = Math.max(maximumCommits, activeCommits);
        await delay(20);
        activeCommits -= 1;
        return "done";
      },
    },
  });
  queue.enqueue("a-1", { name: "a-1", metadata: { vaultId: "a" } });
  queue.enqueue("a-2", { name: "a-2", metadata: { vaultId: "a" } });
  queue.enqueue("b-1", { name: "b-1", metadata: { vaultId: "b" } });
  queue.enqueue("b-2", { name: "b-2", metadata: { vaultId: "b" } });
  queue.start();
  await waitForSnapshot(
    queue,
    (snapshot) => snapshot.tasks.every((task) => task.status === "complete"),
  );
  assert.equal(maximumCommits, 2);
});

test("canceling a queued commit cleans immediately without breaking serialization", async () => {
  const firstCommitStarted = deferred<void>();
  const finishFirstCommit = deferred<void>();
  const thirdCommitStarted = deferred<void>();
  const cleanedTasks: string[] = [];
  let activeCommits = 0;
  let maximumCommits = 0;
  const queue = createUploadQueue({
    concurrency: 3,
    serializeCommit: true,
    adapter: {
      prepare: async (task) => `prepared-${task.source}`,
      upload: async (task) => `uploaded-${task.source}`,
      commit: async (task) => {
        activeCommits += 1;
        maximumCommits = Math.max(maximumCommits, activeCommits);
        try {
          if (task.source === "first") {
            firstCommitStarted.resolve();
            await finishFirstCommit.promise;
          } else if (task.source === "third") {
            thirdCommitStarted.resolve();
          } else {
            assert.fail("The canceled commit must not run");
          }
          return `committed-${task.source}`;
        } finally {
          activeCommits -= 1;
        }
      },
      cleanup: async (task, _artifacts, reason) => {
        if (reason === "canceled") cleanedTasks.push(task.source);
      },
    },
  });
  const first = queue.enqueue("first", { name: "first" });
  const second = queue.enqueue("second", { name: "second" });
  const third = queue.enqueue("third", { name: "third" });
  queue.start();
  await firstCommitStarted.promise;
  await waitForSnapshot(queue, (snapshot) =>
    [second, third].every(
      (id) =>
        snapshot.tasks.find((task) => task.id === id)?.status === "committing",
    ),
  );

  const canceling = queue.cancel(second);
  const canceledBeforeFirstFinished = await Promise.race([
    canceling.then(() => true),
    delay(250).then(() => false),
  ]);

  try {
    assert.equal(canceledBeforeFirstFinished, true);
    assert.deepEqual(cleanedTasks, ["second"]);
    assert.equal(queue.getTask(second)?.status, "canceled");
    assert.equal(queue.getTask(third)?.status, "committing");
  } finally {
    finishFirstCommit.resolve();
  }

  assert.equal(await canceling, true);
  await waitForStatus(queue, first, "complete");
  await thirdCommitStarted.promise;
  await waitForStatus(queue, third, "complete");
  assert.equal(maximumCommits, 1);
});

test("pause prevents a waiting task from starting", async () => {
  let prepareCalls = 0;
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => {
        prepareCalls += 1;
        return "prepared";
      },
      upload: async () => "uploaded",
      commit: async () => "done",
    },
  });
  const id = queue.enqueue("source", { name: "paused" });
  assert.equal(queue.pause(id), true);
  queue.start();
  await delay(20);
  assert.equal(queue.getTask(id)?.status, "paused");
  assert.equal(prepareCalls, 0);
  queue.resume(id);
  await waitForStatus(queue, id, "complete");
  assert.equal(prepareCalls, 1);
});

test("stop prevents new tasks while active tasks finish", async () => {
  let prepareCalls = 0;
  const queue = createUploadQueue({
    concurrency: 1,
    adapter: {
      prepare: async () => {
        prepareCalls += 1;
        await delay(20);
        return "prepared";
      },
      upload: async () => "uploaded",
      commit: async () => "done",
    },
  });
  const first = queue.enqueue("one", { name: "one" });
  const second = queue.enqueue("two", { name: "two" });
  queue.start();
  await waitForStatus(queue, first, "preparing");
  queue.stop();
  await waitForStatus(queue, first, "complete");
  await delay(10);
  assert.equal(queue.getTask(second)?.status, "waiting");
  assert.equal(prepareCalls, 1);
  queue.start();
  await waitForStatus(queue, second, "complete");
  assert.equal(prepareCalls, 2);
});
