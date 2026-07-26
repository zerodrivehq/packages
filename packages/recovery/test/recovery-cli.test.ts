import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCapsule,
  createZeroDriveSharingKeyBackup,
  createZeroDriveVaultIndexCapsule,
  generateRecipientKeyPair,
  type JsonObject,
} from "../../capsule/dist/index.js";
import { runRecoveryCli } from "../dist/main.js";

interface Fixture {
  recoveryPhrase: string;
  vectors: Array<{
    name: string;
    plaintextBase64: string;
    encryptedBase64: string;
  }>;
}

const fixture = JSON.parse(
  await readFile(
    new URL("../../capsule/test/fixtures/personal-file-v1.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

function createIo(options: {
  interactive?: boolean;
  phrase?: string;
  promptError?: Error;
} = {}) {
  let stdout = "";
  let stderr = "";
  let prompts = 0;
  return {
    io: {
      interactive: options.interactive ?? true,
      promptRecoveryPhrase: async () => {
        prompts += 1;
        if (options.promptError) throw options.promptError;
        return options.phrase ?? fixture.recoveryPhrase;
      },
      writeError: (message: string) => {
        stderr += message;
      },
      writeOutput: (message: string) => {
        stdout += message;
      },
    },
    result: () => ({ prompts, stderr, stdout }),
  };
}

async function createInput(name = "text") {
  const directory = await mkdtemp(join(tmpdir(), "zerodrive-recovery-test-"));
  const vector = fixture.vectors.find((candidate) => candidate.name === name)!;
  const input = join(directory, "downloaded.zd");
  const output = join(directory, "recovered.bin");
  await writeFile(input, Buffer.from(vector.encryptedBase64, "base64"));
  return { directory, input, output, vector };
}

test("recovers a downloaded personal file without exposing the phrase", async () => {
  const { input, output, vector } = await createInput("binary");
  const capture = createIo();
  const code = await runRecoveryCli(
    ["decrypt", input, "--out", output],
    capture.io,
  );

  assert.equal(code, 0);
  assert.deepEqual(await readFile(output), Buffer.from(vector.plaintextBase64, "base64"));
  const result = capture.result();
  assert.equal(result.prompts, 1);
  assert.match(result.stdout, /Recovered file written/);
  assert.equal(result.stderr, "");
  assert.doesNotMatch(result.stdout, new RegExp(fixture.recoveryPhrase));
  if (process.platform !== "win32") {
    assert.equal((await stat(output)).mode & 0o777, 0o600);
  }
});

test("detects and recovers a capsule v1 file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zerodrive-recovery-test-"));
  const input = join(directory, "document.zdcp");
  const output = join(directory, "document.txt");
  const plaintext = new TextEncoder().encode("recovered from capsule v1");
  const created = await createCapsule({
    plaintext,
    metadata: {
      name: "document.txt",
      mimeType: "text/plain",
      size: plaintext.byteLength,
    },
    recoveryPhrase: fixture.recoveryPhrase,
  });
  await writeFile(input, created.bytes);

  const capture = createIo();
  assert.equal(
    await runRecoveryCli(["decrypt", input, "--out", output], capture.io),
    0,
  );
  assert.deepEqual(await readFile(output), Buffer.from(plaintext));
  assert.equal(capture.result().prompts, 1);
  assert.doesNotMatch(capture.result().stdout, new RegExp(fixture.recoveryPhrase));
  if (process.platform !== "win32") {
    assert.equal((await stat(output)).mode & 0o777, 0o600);
  }
});

test("shows help and version without prompting", async () => {
  for (const argument of ["--help", "--version"]) {
    const capture = createIo();
    assert.equal(await runRecoveryCli([argument], capture.io), 0);
    assert.equal(capture.result().prompts, 0);
    assert.equal(capture.result().stderr, "");
  }

  const version = createIo();
  assert.equal(await runRecoveryCli(["--version"], version.io), 0);
  assert.equal(version.result().stdout, "0.4.0\n");
});

test("recovers capsule vault indexes as JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zerodrive-recovery-test-"));
  const input = join(directory, "db-list.zdcp");
  const output = join(directory, "db-list.json");
  const index = { files: [{ id: "one" }], folders: [] };
  await writeFile(
    input,
    await createZeroDriveVaultIndexCapsule({
      index,
      recoveryPhrase: fixture.recoveryPhrase,
    }),
  );

  const capture = createIo();
  assert.equal(
    await runRecoveryCli(["decrypt", input, "--out", output], capture.io),
    0,
  );
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), index);
});

test("recovers new sharing-key backups as a direct private JWK", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zerodrive-recovery-test-"));
  const input = join(directory, "sharing-key.zdcp");
  const output = join(directory, "private-key.json");
  const pair = await generateRecipientKeyPair();
  await writeFile(
    input,
    await createZeroDriveSharingKeyBackup({
      privateKeyJwk: JSON.parse(JSON.stringify(pair.privateKeyJwk)) as JsonObject,
      publicKeyJwk: JSON.parse(JSON.stringify(pair.publicKeyJwk)) as JsonObject,
      recoveryPhrase: fixture.recoveryPhrase,
      keyVersion: 2,
    }),
  );

  const capture = createIo();
  assert.equal(
    await runRecoveryCli(["decrypt", input, "--out", output], capture.io),
    0,
  );
  const recovered = JSON.parse(await readFile(output, "utf8")) as JsonWebKey;
  assert.equal(recovered.d, pair.privateKeyJwk.d);
  assert.equal("privateKeyJwk" in recovered, false);
});

test("rejects missing arguments and any phrase argument", async () => {
  for (const argv of [
    [] as string[],
    ["decrypt", "input.zd"],
    ["decrypt", "input.zd", "--out", "output", "--phrase", "secret"],
  ]) {
    const capture = createIo();
    assert.equal(await runRecoveryCli(argv, capture.io), 1);
    assert.equal(capture.result().prompts, 0);
    assert.match(capture.result().stderr, /Invalid command/);
    assert.doesNotMatch(capture.result().stderr, /secret/);
  }
});

test("requires an interactive terminal", async () => {
  const { input, output } = await createInput();
  const capture = createIo({ interactive: false });
  assert.equal(
    await runRecoveryCli(["decrypt", input, "--out", output], capture.io),
    1,
  );
  assert.equal(capture.result().prompts, 0);
  assert.match(capture.result().stderr, /interactive terminal/);
});

test("rejects missing and non-file inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zerodrive-recovery-test-"));
  for (const input of [join(directory, "missing"), directory]) {
    const capture = createIo();
    assert.equal(
      await runRecoveryCli(
        ["decrypt", input, "--out", join(directory, "out")],
        capture.io,
      ),
      1,
    );
    assert.equal(capture.result().prompts, 0);
  }
});

test("rejects identical input/output paths and existing output", async () => {
  const { input, output } = await createInput();
  const samePath = createIo();
  assert.equal(
    await runRecoveryCli(["decrypt", input, "--out", input], samePath.io),
    1,
  );
  assert.match(samePath.result().stderr, /must be different/);

  await writeFile(output, "keep me");
  const existing = createIo();
  assert.equal(
    await runRecoveryCli(["decrypt", input, "--out", output], existing.io),
    1,
  );
  assert.equal(existing.result().prompts, 0);
  assert.equal(await readFile(output, "utf8"), "keep me");
});

test("reports invalid phrases and damaged files without creating output", async () => {
  const invalid = await createInput();
  const invalidIo = createIo({ phrase: "not a mnemonic" });
  assert.equal(
    await runRecoveryCli(
      ["decrypt", invalid.input, "--out", invalid.output],
      invalidIo.io,
    ),
    1,
  );
  assert.match(invalidIo.result().stderr, /phrase is invalid/);
  await assert.rejects(stat(invalid.output), { code: "ENOENT" });

  const damaged = await createInput();
  const encrypted = await readFile(damaged.input);
  encrypted[encrypted.length - 1]! ^= 0x01;
  await writeFile(damaged.input, encrypted);
  const damagedIo = createIo();
  assert.equal(
    await runRecoveryCli(
      ["decrypt", damaged.input, "--out", damaged.output],
      damagedIo.io,
    ),
    1,
  );
  assert.match(damagedIo.result().stderr, /phrase may be incorrect or the file may be damaged/);
  await assert.rejects(stat(damaged.output), { code: "ENOENT" });
});

test("handles a cancelled phrase prompt", async () => {
  const { input, output } = await createInput();
  const capture = createIo({ promptError: new Error("cancelled") });
  assert.equal(
    await runRecoveryCli(["decrypt", input, "--out", output], capture.io),
    1,
  );
  assert.match(capture.result().stderr, /prompt was cancelled/);
});
