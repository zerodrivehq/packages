import { RecoveryError } from "./errors.ts";
import type {
  CreateRecoveryManifestInput,
  JsonObject,
  JsonValue,
  RecoveryItemType,
  RecoveryManifest,
  RecoveryManifestItem,
  RecoveryManifestSummary,
  RecoveryManifestValidationResult,
} from "./types.ts";

export const RECOVERY_MANIFEST_VERSION = 1;
export const DEFAULT_RECOVERY_APP = "zerodrive";

const ITEM_TYPES: readonly RecoveryItemType[] = [
  "personal-file",
  "shared-file",
  "private-key-backup",
];

const KEY_HINT_KINDS = [
  "recovery-phrase",
  "recipient-private-key",
  "wrapped-private-key",
  "unknown",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isIsoDate(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function normalizeCreatedAt(value: Date | string | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function isSafeRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.includes("\0") ||
    path.includes("://")
  ) {
    return false;
  }

  const segments = path.split(/[\\/]+/);
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function validateItem(
  item: unknown,
  path: string,
  issues: RecoveryManifestValidationResult["issues"],
): RecoveryManifestItem | null {
  if (!isRecord(item)) {
    issues.push({ path, message: "item must be an object" });
    return null;
  }

  if (typeof item.id !== "string" || item.id.trim().length === 0) {
    issues.push({ path: `${path}.id`, message: "id must be a non-empty string" });
  }

  if (!ITEM_TYPES.includes(item.type as RecoveryItemType)) {
    issues.push({
      path: `${path}.type`,
      message: `type must be one of ${ITEM_TYPES.join(", ")}`,
    });
  }

  if (
    typeof item.capsulePath !== "string" ||
    !isSafeRelativePath(item.capsulePath)
  ) {
    issues.push({
      path: `${path}.capsulePath`,
      message: "capsulePath must be a safe relative path",
    });
  }

  const encryptedSize = item.encryptedSize;
  if (
    encryptedSize !== undefined &&
    (typeof encryptedSize !== "number" ||
      !Number.isSafeInteger(encryptedSize) ||
      encryptedSize < 0)
  ) {
    issues.push({
      path: `${path}.encryptedSize`,
      message: "encryptedSize must be a non-negative safe integer",
    });
  }

  if (
    item.sha256 !== undefined &&
    (typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256))
  ) {
    issues.push({
      path: `${path}.sha256`,
      message: "sha256 must be a lowercase hex SHA-256 digest",
    });
  }

  if (item.metadata !== undefined) {
    if (!isRecord(item.metadata) || item.metadata.encrypted !== true) {
      issues.push({
        path: `${path}.metadata`,
        message: "metadata must be an object with encrypted set to true",
      });
    } else if (!isJsonValue(item.metadata)) {
      issues.push({
        path: `${path}.metadata`,
        message: "metadata must be JSON-compatible",
      });
    }
  }

  if (item.keyHint !== undefined) {
    if (!isRecord(item.keyHint) || !isJsonValue(item.keyHint)) {
      issues.push({
        path: `${path}.keyHint`,
        message: "keyHint must be a JSON-compatible object",
      });
    } else {
      const keyHintKind = item.keyHint.kind;
      if (
        typeof keyHintKind !== "string" ||
        !KEY_HINT_KINDS.includes(
          keyHintKind as (typeof KEY_HINT_KINDS)[number],
        )
      ) {
        issues.push({
          path: `${path}.keyHint.kind`,
          message: `keyHint.kind must be one of ${KEY_HINT_KINDS.join(", ")}`,
        });
      }
      const keyVersion = item.keyHint.keyVersion;
      if (
        keyVersion !== undefined &&
        (typeof keyVersion !== "number" ||
          !Number.isSafeInteger(keyVersion) ||
          keyVersion < 1)
      ) {
        issues.push({
          path: `${path}.keyHint.keyVersion`,
          message: "keyHint.keyVersion must be a positive safe integer",
        });
      }
      if (
        item.keyHint.publicKeyFingerprint !== undefined &&
        (typeof item.keyHint.publicKeyFingerprint !== "string" ||
          !/^[0-9a-f]{64}$/.test(item.keyHint.publicKeyFingerprint))
      ) {
        issues.push({
          path: `${path}.keyHint.publicKeyFingerprint`,
          message:
            "keyHint.publicKeyFingerprint must be a lowercase hex SHA-256 digest",
        });
      }
    }
  }

  return item as RecoveryManifestItem;
}

export function validateRecoveryManifest(
  value: unknown,
): RecoveryManifestValidationResult {
  const issues: RecoveryManifestValidationResult["issues"] = [];

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "$", message: "manifest must be an object" }],
    };
  }

  if (value.version !== RECOVERY_MANIFEST_VERSION) {
    issues.push({
      path: "$.version",
      message: "manifest version is unsupported",
    });
  }

  if (typeof value.createdAt !== "string" || !isIsoDate(value.createdAt)) {
    issues.push({
      path: "$.createdAt",
      message: "createdAt must be an ISO timestamp",
    });
  }

  if (typeof value.app !== "string" || value.app.trim().length === 0) {
    issues.push({
      path: "$.app",
      message: "app must be a non-empty string",
    });
  }

  if (!Array.isArray(value.items)) {
    issues.push({ path: "$.items", message: "items must be an array" });
  } else {
    const seenIds = new Set<string>();
    value.items.forEach((item, index) => {
      const validated = validateItem(item, `$.items[${index}]`, issues);
      if (!validated) return;
      if (seenIds.has(validated.id)) {
        issues.push({
          path: `$.items[${index}].id`,
          message: "item id must be unique",
        });
      }
      seenIds.add(validated.id);
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    manifest: cloneJson(value as RecoveryManifest),
    issues: [],
  };
}

export function assertRecoveryManifest(
  value: unknown,
): asserts value is RecoveryManifest {
  const result = validateRecoveryManifest(value);
  if (!result.ok) {
    const unsupportedVersion = result.issues.some(
      (issue) => issue.path === "$.version",
    );
    throw new RecoveryError(
      unsupportedVersion
        ? "RECOVERY_MANIFEST_UNSUPPORTED_VERSION"
        : "RECOVERY_MANIFEST_MALFORMED",
      unsupportedVersion
        ? "Recovery manifest version is unsupported"
        : "Recovery manifest is malformed",
      result.issues,
    );
  }
}

export function createRecoveryManifest(
  input: CreateRecoveryManifestInput,
): RecoveryManifest {
  const manifest: RecoveryManifest = {
    version: RECOVERY_MANIFEST_VERSION,
    createdAt: normalizeCreatedAt(input.createdAt),
    app: input.app || DEFAULT_RECOVERY_APP,
    items: cloneJson(input.items as unknown as JsonObject[]) as RecoveryManifestItem[],
  };
  assertRecoveryManifest(manifest);
  return manifest;
}

export function parseRecoveryManifest(
  serialized: string | Uint8Array | ArrayBuffer,
): RecoveryManifest {
  const text =
    typeof serialized === "string"
      ? serialized
      : new TextDecoder().decode(serialized);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RecoveryError(
      "RECOVERY_MANIFEST_MALFORMED",
      "Recovery manifest is not valid JSON",
      [{ path: "$", message: "manifest must be valid JSON" }],
    );
  }

  assertRecoveryManifest(parsed);
  return cloneJson(parsed);
}

export const readRecoveryManifest = parseRecoveryManifest;

export function serializeRecoveryManifest(
  manifest: RecoveryManifest,
  options: { pretty?: boolean } = {},
): string {
  assertRecoveryManifest(manifest);
  return JSON.stringify(manifest, null, options.pretty ? 2 : 0);
}

export function summarizeRecoveryManifest(
  manifest: RecoveryManifest,
): RecoveryManifestSummary {
  assertRecoveryManifest(manifest);

  const itemTypes = {
    "personal-file": 0,
    "shared-file": 0,
    "private-key-backup": 0,
  } satisfies Record<RecoveryItemType, number>;

  let encryptedBytes = 0;
  let hasAllSizes = true;

  for (const item of manifest.items) {
    itemTypes[item.type] += 1;
    if (typeof item.encryptedSize === "number") {
      encryptedBytes += item.encryptedSize;
    } else {
      hasAllSizes = false;
    }
  }

  return {
    version: manifest.version,
    app: manifest.app,
    createdAt: manifest.createdAt,
    totalItems: manifest.items.length,
    itemTypes,
    encryptedBytes: hasAllSizes ? encryptedBytes : null,
  };
}
