import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "zerodrive-packed-smoke-"));
const project = join(directory, "project");

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} failed`);
  }
  return result.stdout.trim();
}

try {
  for (const packageName of [
    "@zerodrivehq/capsule",
    "@zerodrivehq/recovery",
    "@zerodrivehq/upload-queue",
  ]) {
    run("pnpm", [
      "--filter",
      packageName,
      "pack",
      "--pack-destination",
      directory,
    ]);
  }

  const tarballs = readdirSync(directory)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => join(directory, name));
  if (tarballs.length !== 3) throw new Error("Expected three package tarballs");

  mkdirSync(project);
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "zerodrive-packed-smoke", private: true, type: "module" }),
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs],
    project,
  );

  const version = run(
    "npx",
    ["--no-install", "zerodrive-recovery", "--version"],
    project,
  );
  if (version !== "0.4.0") throw new Error(`Unexpected CLI version: ${version}`);

  const uploadQueueModule = await import(
    pathToFileURL(
      join(project, "node_modules/@zerodrivehq/upload-queue/dist/index.js"),
    ).href
  );
  const lifecycle = [];
  const uploadQueue = uploadQueueModule.createUploadQueue({
    adapter: {
      prepare: async (task) => {
        lifecycle.push(`prepare:${task.name}`);
        return `encrypted:${task.source}`;
      },
      upload: async (_task, prepared) => {
        lifecycle.push(`upload:${prepared}`);
        return { driveId: "packed-drive-id" };
      },
      commit: async (_task, uploaded) => {
        lifecycle.push(`commit:${uploaded.driveId}`);
        return uploaded.driveId;
      },
    },
  });
  const uploadTaskId = uploadQueue.enqueue("plain", { name: "packed.txt" });
  const uploadCompleted = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Packed upload queue timed out")),
      2_000,
    );
    const unsubscribe = uploadQueue.subscribe((snapshot) => {
      const task = snapshot.tasks.find(
        (candidate) => candidate.id === uploadTaskId,
      );
      if (task?.status !== "complete") return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(task);
    });
  });
  uploadQueue.start();
  const completedUpload = await uploadCompleted;
  if (
    completedUpload.result !== "packed-drive-id" ||
    lifecycle.join(",") !==
      "prepare:packed.txt,upload:encrypted:plain,commit:packed-drive-id"
  ) {
    throw new Error("Packed upload queue lifecycle failed");
  }

  const capsuleModule = await import(
    pathToFileURL(
      join(project, "node_modules/@zerodrivehq/capsule/dist/index.js"),
    ).href
  );
  const fixture = JSON.parse(
    readFileSync(
      join(process.cwd(), "packages/capsule/test/fixtures/capsule-v1.json"),
      "utf8",
    ),
  );
  const vector = fixture.vectors.find((candidate) => candidate.name === "binary");

  const personalContent = new TextEncoder().encode("packed personal capsule");
  const personalCapsule =
    await capsuleModule.createZeroDrivePersonalFileCapsule({
      content: personalContent,
      metadata: { name: "packed.txt", mimeType: "text/plain" },
      recoveryPhrase: fixture.recoveryPhrase,
    });
  const openedPersonal = await capsuleModule.openZeroDrivePersonalFile({
    encryptedBytes: personalCapsule,
    recoveryPhrase: fixture.recoveryPhrase,
  });
  if (
    openedPersonal.format !== "capsule_v1" ||
    openedPersonal.metadata.name !== "packed.txt" ||
    !Buffer.from(openedPersonal.content).equals(Buffer.from(personalContent))
  ) {
    throw new Error("Packed personal-file adapters failed");
  }

  const vaultIndex = { files: [{ id: "packed-file" }], folders: [] };
  const vaultCapsule = await capsuleModule.createZeroDriveVaultIndexCapsule({
    index: vaultIndex,
    recoveryPhrase: fixture.recoveryPhrase,
  });
  const openedVault = await capsuleModule.openZeroDriveVaultIndex({
    encryptedBytes: vaultCapsule,
    recoveryPhrase: fixture.recoveryPhrase,
  });
  if (JSON.stringify(openedVault.index) !== JSON.stringify(vaultIndex)) {
    throw new Error("Packed vault-index adapters failed");
  }

  const recipient = await capsuleModule.generateRecipientKeyPair();
  const sharedCapsule = await capsuleModule.createZeroDriveSharedFileCapsule({
    content: personalContent,
    metadata: { name: "shared.txt", mimeType: "text/plain" },
    recipients: [{ publicKeyJwk: recipient.publicKeyJwk, keyVersion: 1 }],
  });
  const openedShared = await capsuleModule.openZeroDriveSharedFile({
    encryptedBytes: sharedCapsule,
    recipientPrivateKeyJwks: [
      { privateKeyJwk: recipient.privateKeyJwk },
    ],
  });
  if (!Buffer.from(openedShared.content).equals(Buffer.from(personalContent))) {
    throw new Error("Packed shared-file adapters failed");
  }

  const input = join(project, "input.zdcp");
  const output = join(project, "output.bin");
  writeFileSync(input, Buffer.from(vector.capsuleBase64, "base64"));

  const recoveryModule = await import(
    pathToFileURL(
      join(project, "node_modules/@zerodrivehq/recovery/dist/main.js"),
    ).href
  );
  const code = await recoveryModule.runRecoveryCli(
    ["decrypt", input, "--out", output],
    {
      interactive: true,
      promptRecoveryPhrase: async () => fixture.recoveryPhrase,
      writeError: (message) => {
        throw new Error(message.trim());
      },
      writeOutput: () => {},
    },
  );
  if (code !== 0) throw new Error("Packed recovery CLI failed");
  const recovered = readFileSync(output);
  const expected = Buffer.from(vector.plaintextBase64, "base64");
  if (!recovered.equals(expected)) throw new Error("Packed CLI output differs");

  process.stdout.write("Packed package smoke tests passed.\n");
} finally {
  rmSync(directory, { force: true, recursive: true });
}
