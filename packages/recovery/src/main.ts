import { lstat, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  CapsuleError,
  openZeroDrivePersonalFile,
  openZeroDriveSharingKeyBackup,
  type JsonObject,
} from "@zerodrivehq/capsule";

import { writePrivateOutput } from "./output.js";
import { promptForRecoveryPhrase } from "./prompt.js";

const VERSION = "0.3.0";
const HELP = `ZeroDrive offline recovery

Usage:
  zerodrive-recovery decrypt <input> --out <output>

Options:
  --out <path>  Recovered file path (required)
  -h, --help    Show help
  -v, --version Show version
`;

interface RecoveryCliIo {
  readonly interactive: boolean;
  promptRecoveryPhrase(): Promise<string>;
  writeError(message: string): void;
  writeOutput(message: string): void;
}

const defaultIo: RecoveryCliIo = {
  interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  promptRecoveryPhrase: promptForRecoveryPhrase,
  writeError: (message) => process.stderr.write(message),
  writeOutput: (message) => process.stdout.write(message),
};

class CliError extends Error {}

function isSharingKeyBackup(metadata: JsonObject): boolean {
  const attributes = metadata.attributes;
  return (
    typeof attributes === "object" &&
    attributes !== null &&
    !Array.isArray(attributes) &&
    attributes.kind === "private-key-backup"
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function ensureInputFile(inputPath: string): Promise<void> {
  let inputStat;
  try {
    inputStat = await stat(inputPath);
  } catch {
    throw new CliError("Input file could not be read.");
  }
  if (!inputStat.isFile()) {
    throw new CliError("Input path must be a regular file.");
  }
}

async function ensureOutputDoesNotExist(outputPath: string): Promise<void> {
  try {
    await lstat(outputPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw new CliError("Output path could not be checked.");
  }
  throw new CliError("Output file already exists.");
}

function capsuleMessage(error: CapsuleError): string {
  switch (error.code) {
    case "INVALID_RECOVERY_PHRASE":
      return "Recovery phrase is invalid.";
    case "INVALID_ENCRYPTED_FILE":
      return "Input is not a supported ZeroDrive personal file.";
    case "DECRYPTION_FAILED":
      return "Decryption failed. The recovery phrase may be incorrect or the file may be damaged.";
    case "CAPSULE_AUTHENTICATION_FAILED":
    case "CAPSULE_KEY_UNWRAP_FAILED":
    case "CAPSULE_NO_MATCHING_KEY":
      return "Decryption failed. The recovery phrase may be incorrect or the file may be damaged.";
    case "CAPSULE_MALFORMED":
    case "CAPSULE_METADATA_INVALID":
    case "CAPSULE_UNSUPPORTED_SUITE":
    case "CAPSULE_UNSUPPORTED_VERSION":
      return "Input is not a supported ZeroDrive capsule.";
    case "CAPSULE_ACCESS_REQUIRED":
    case "CAPSULE_KEY_INVALID":
    case "CAPSULE_RECIPIENT_INVALID":
    case "LEGACY_SHARED_FILE_INVALID":
      return "Decryption failed.";
  }
  return "Decryption failed.";
}

export async function runRecoveryCli(
  argv: readonly string[],
  io: RecoveryCliIo = defaultIo,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        out: { type: "string" },
        version: { type: "boolean", short: "v" },
      },
      strict: true,
    });
  } catch {
    io.writeError(`Invalid command.\n\n${HELP}`);
    return 1;
  }

  if (parsed.values.help === true) {
    io.writeOutput(HELP);
    return 0;
  }
  if (parsed.values.version === true) {
    io.writeOutput(`${VERSION}\n`);
    return 0;
  }

  const [command, inputArgument, ...extraPositionals] = parsed.positionals;
  const outputArgument = parsed.values.out;
  if (
    command !== "decrypt" ||
    inputArgument === undefined ||
    extraPositionals.length > 0 ||
    outputArgument === undefined ||
    outputArgument.length === 0
  ) {
    io.writeError(`Invalid command.\n\n${HELP}`);
    return 1;
  }

  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);
  let encryptedBytes: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  let recoveryPhrase = "";

  try {
    if (inputPath === outputPath) {
      throw new CliError("Input and output paths must be different.");
    }
    await ensureInputFile(inputPath);
    await ensureOutputDoesNotExist(outputPath);
    if (!io.interactive) {
      throw new CliError(
        "Recovery requires an interactive terminal for the hidden phrase prompt.",
      );
    }

    try {
      recoveryPhrase = await io.promptRecoveryPhrase();
    } catch {
      throw new CliError("Recovery phrase prompt was cancelled.");
    }

    try {
      encryptedBytes = await readFile(inputPath);
    } catch {
      throw new CliError("Input file could not be read.");
    }

    try {
      const opened = await openZeroDrivePersonalFile({
        encryptedBytes,
        recoveryPhrase,
      });
      plaintext = opened.content;
      if (isSharingKeyBackup(opened.metadata)) {
        const backup = await openZeroDriveSharingKeyBackup({
          encryptedBytes,
          recoveryPhrase,
        });
        plaintext.fill(0);
        plaintext = new TextEncoder().encode(
          JSON.stringify(backup.privateKeyJwk),
        );
      }
    } catch (error) {
      if (error instanceof CapsuleError) {
        throw new CliError(capsuleMessage(error));
      }
      throw new CliError("Decryption failed.");
    }

    if (plaintext === undefined) {
      throw new CliError("Decryption failed.");
    }

    try {
      await writePrivateOutput(outputPath, plaintext);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new CliError("Output file already exists.");
      }
      throw new CliError("Recovered file could not be written.");
    }

    io.writeOutput(`Recovered file written to ${outputPath}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof CliError ? error.message : "Recovery failed.";
    io.writeError(`${message}\n`);
    return 1;
  } finally {
    recoveryPhrase = "";
    encryptedBytes?.fill(0);
    plaintext?.fill(0);
  }
}
