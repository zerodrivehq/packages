import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const packages = [
  { name: "@zerodrivehq/capsule" },
  { name: "@zerodrivehq/recovery" },
];
const directory = mkdtempSync(join(tmpdir(), "zerodrive-pack-check-"));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.status ?? 1;
    throw new Error(`${command} failed`);
  }
  return result.stdout;
}

try {
  for (const packageInfo of packages) {
    run("pnpm", [
      "--filter",
      packageInfo.name,
      "pack",
      "--pack-destination",
      directory,
    ]);
  }

  const tarballs = readdirSync(directory).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== packages.length) {
    throw new Error(`Expected ${packages.length} tarballs, found ${tarballs.length}`);
  }

  for (const tarballName of tarballs) {
    const tarball = join(directory, tarballName);
    const entries = run("tar", ["-tzf", tarball])
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const entry of entries) {
      const allowed =
        entry === "package/package.json" ||
        entry === "package/README.md" ||
        entry === "package/LICENSE" ||
        entry.startsWith("package/dist/");
      if (!allowed) throw new Error(`Unexpected packed file: ${entry}`);
    }

    const packageJsonText = run("tar", [
      "-xOzf",
      tarball,
      "package/package.json",
    ]);
    const packageJson = JSON.parse(packageJsonText);
    if (packageJson.dependencies?.["@zerodrivehq/capsule"]?.startsWith("workspace:")) {
      throw new Error("Packed recovery dependency still uses the workspace protocol");
    }
    if (
      packageJson.name === "@zerodrivehq/recovery" &&
      packageJson.dependencies?.["@zerodrivehq/capsule"] !== "^0.1.0"
    ) {
      throw new Error("Packed recovery dependency is not ^0.1.0");
    }
  }

  process.stdout.write("Package contents are publish-ready.\n");
} finally {
  rmSync(directory, { force: true, recursive: true });
}
