import { stableStringify } from "../encoding.js";
import { CapsuleError } from "../errors.js";
import type {
  CapsuleMetadata,
  JsonObject,
  JsonValue,
} from "../types.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): asserts value is JsonValue {
  if (depth > 32) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "ZeroDrive JSON nesting is too deep",
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "ZeroDrive JSON contains a non-finite number",
    );
  }
  if (typeof value !== "object") {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "ZeroDrive value is not JSON-compatible",
    );
  }
  if (seen.has(value)) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "ZeroDrive JSON contains a cycle",
    );
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertJsonValue(item, seen, depth + 1);
      return;
    }
    if (!isJsonObject(value)) {
      throw new CapsuleError(
        "CAPSULE_METADATA_INVALID",
        "ZeroDrive JSON contains a non-plain object",
      );
    }
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new CapsuleError(
          "CAPSULE_METADATA_INVALID",
          "ZeroDrive JSON contains a forbidden key",
        );
      }
      assertJsonValue(item, seen, depth + 1);
    }
  } finally {
    seen.delete(value);
  }
}

export function encodeJson(value: JsonValue): Uint8Array<ArrayBuffer> {
  assertJsonValue(value, new WeakSet(), 0);
  return new TextEncoder().encode(stableStringify(value));
}

export function decodeJson(bytes: Uint8Array): JsonValue {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "ZeroDrive JSON is malformed",
    );
  }
  assertJsonValue(value, new WeakSet(), 0);
  return value;
}

export function createZeroDriveCapsuleMetadata(
  kind: string,
  size: number,
  metadata?: JsonObject,
): CapsuleMetadata {
  const name =
    typeof metadata?.name === "string" && metadata.name.length > 0
      ? metadata.name
      : kind === "zerodrive.vault-index"
        ? "db-list.json"
        : "zerodrive-file";
  const mimeType =
    typeof metadata?.mimeType === "string" && metadata.mimeType.length > 0
      ? metadata.mimeType
      : kind === "zerodrive.vault-index"
        ? "application/json"
        : "application/octet-stream";
  const createdAt =
    typeof metadata?.createdAt === "string" &&
    !Number.isNaN(Date.parse(metadata.createdAt))
      ? metadata.createdAt
      : undefined;

  return {
    name,
    mimeType,
    size,
    ...(createdAt === undefined ? {} : { createdAt }),
    attributes: {
      kind,
      version: 1,
      ...(metadata === undefined ? {} : { metadata }),
    },
  };
}

export function metadataFromCapsule(
  metadata: CapsuleMetadata,
): JsonObject {
  const original = metadata.attributes?.metadata;
  if (isJsonObject(original)) return original;
  return {
    name: metadata.name,
    mimeType: metadata.mimeType,
    size: metadata.size,
    ...(metadata.createdAt === undefined
      ? {}
      : { createdAt: metadata.createdAt }),
    ...(metadata.attributes === undefined
      ? {}
      : { attributes: metadata.attributes }),
  };
}

export function jsonWebKeyToJsonObject(
  value: JsonWebKey,
  message: string,
): JsonObject {
  let json: unknown;
  try {
    json = JSON.parse(JSON.stringify(value));
  } catch {
    throw new CapsuleError("CAPSULE_KEY_INVALID", message);
  }
  if (!isJsonObject(json)) {
    throw new CapsuleError("CAPSULE_KEY_INVALID", message);
  }
  assertJsonValue(json, new WeakSet(), 0);
  return json;
}
