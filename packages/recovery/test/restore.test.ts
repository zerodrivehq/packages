import assert from "node:assert/strict";
import test from "node:test";
import {
  RecoveryError,
  restoreCapsuleItem,
  type RecoveryManifestItem,
} from "../src/index.ts";

const item: RecoveryManifestItem = {
  id: "item_01",
  type: "personal-file",
  capsulePath: "objects/item_01.zdcapsule",
  metadata: { encrypted: true },
};

test("restoreCapsuleItem delegates capsule opening and returns bytes", async () => {
  const restored = await restoreCapsuleItem({
    item,
    capsuleBytes: new Uint8Array([1, 2, 3]),
    async openCapsule(input) {
      assert.equal(input.item.id, "item_01");
      assert.deepEqual(Array.from(input.capsuleBytes as Uint8Array), [1, 2, 3]);
      return {
        plaintext: new Uint8Array([4, 5, 6]),
        metadata: { name: "photo.jpg" },
      };
    },
  });

  assert.deepEqual(Array.from(restored.plaintext), [4, 5, 6]);
  assert.deepEqual(restored.metadata, { name: "photo.jpg" });
});

test("restoreCapsuleItem rejects malformed recovery items", async () => {
  await assert.rejects(
    () =>
      restoreCapsuleItem({
        item: {
          ...item,
          capsulePath: "/absolute/path",
        },
        capsuleBytes: new Uint8Array(),
        async openCapsule() {
          throw new Error("should not be called");
        },
      }),
    (error: unknown) =>
      error instanceof RecoveryError &&
      error.code === "RECOVERY_ITEM_INVALID",
  );
});

test("restoreCapsuleItem wraps opener failures", async () => {
  await assert.rejects(
    () =>
      restoreCapsuleItem({
        item,
        capsuleBytes: new Uint8Array([1]),
        async openCapsule() {
          throw new Error("bad key");
        },
      }),
    (error: unknown) =>
      error instanceof RecoveryError &&
      error.code === "RECOVERY_RESTORE_FAILED",
  );
});
