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
  if (tarballs.length !== 2) throw new Error("Expected two package tarballs");

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
  if (version !== "0.2.0") throw new Error(`Unexpected CLI version: ${version}`);

  const fixture = JSON.parse(
    readFileSync(
      join(process.cwd(), "packages/capsule/test/fixtures/capsule-v1.json"),
      "utf8",
    ),
  );
  const vector = fixture.vectors.find((candidate) => candidate.name === "binary");
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

  process.stdout.write("Packed capsule and recovery CLI smoke test passed.\n");
} finally {
  rmSync(directory, { force: true, recursive: true });
}
