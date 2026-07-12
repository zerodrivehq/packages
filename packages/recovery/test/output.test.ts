import assert from "node:assert/strict";
import test from "node:test";

import {
  writePrivateOutput,
  type PrivateOutputFileSystem,
} from "../dist/output.js";

test("removes a partial output after a write failure", async () => {
  let closed = false;
  let unlinked = "";
  const fileSystem: PrivateOutputFileSystem = {
    open: async (_path, flags, mode) => {
      assert.equal(flags, "wx");
      assert.equal(mode, 0o600);
      return {
        close: async () => {
          closed = true;
        },
        sync: async () => undefined,
        writeFile: async () => {
          throw new Error("disk full");
        },
      };
    },
    unlink: async (path) => {
      unlinked = path;
    },
  };

  await assert.rejects(
    writePrivateOutput("/tmp/recovered", new Uint8Array([1, 2, 3]), fileSystem),
    /disk full/,
  );
  assert.equal(closed, true);
  assert.equal(unlinked, "/tmp/recovered");
});
