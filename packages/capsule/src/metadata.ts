import { CAPSULE_MAX_METADATA_BYTES } from "./constants.js";
import { CapsuleError } from "./errors.js";
import type { CapsuleMetadata, JsonObject, JsonValue } from "./types.js";

interface SerializedMetadata extends CapsuleMetadata {
  version: 1;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, depth = 0): asserts value is JsonValue {
  if (depth > 32) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Metadata nesting is too deep",
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
      "Metadata number is not finite",
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new CapsuleError(
          "CAPSULE_METADATA_INVALID",
          "Metadata contains a forbidden key",
        );
      }
      assertJsonValue(item, depth + 1);
    }
    return;
  }
  throw new CapsuleError(
    "CAPSULE_METADATA_INVALID",
    "Metadata is not JSON-compatible",
  );
}

function assertMetadataShape(
  value: unknown,
  plaintextLength: number,
  requireVersion: boolean,
): asserts value is SerializedMetadata {
  if (!isPlainObject(value)) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata must be an object",
    );
  }
  if (requireVersion && value.version !== 1) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata version is unsupported",
    );
  }
  if (
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.name.length > 1024
  ) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata name is invalid",
    );
  }
  if (
    typeof value.mimeType !== "string" ||
    value.mimeType.length === 0 ||
    value.mimeType.length > 255
  ) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata MIME type is invalid",
    );
  }
  if (
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    value.size !== plaintextLength
  ) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata size does not match content",
    );
  }
  if (value.createdAt !== undefined) {
    if (
      typeof value.createdAt !== "string" ||
      Number.isNaN(Date.parse(value.createdAt))
    ) {
      throw new CapsuleError(
        "CAPSULE_METADATA_INVALID",
        "Capsule metadata timestamp is invalid",
      );
    }
  }
  if (value.attributes !== undefined) {
    if (!isPlainObject(value.attributes)) {
      throw new CapsuleError(
        "CAPSULE_METADATA_INVALID",
        "Capsule metadata attributes must be an object",
      );
    }
    assertJsonValue(value.attributes);
  }
}

export function serializeCapsuleMetadata(
  metadata: CapsuleMetadata,
  plaintextLength: number,
): Uint8Array<ArrayBuffer> {
  assertMetadataShape(metadata, plaintextLength, false);
  const serialized: SerializedMetadata = { ...metadata, version: 1 };
  const bytes = new TextEncoder().encode(JSON.stringify(serialized));
  if (bytes.byteLength > CAPSULE_MAX_METADATA_BYTES) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata is too large",
    );
  }
  return bytes;
}

export function parseCapsuleMetadata(
  bytes: Uint8Array,
  plaintextLength: number,
): CapsuleMetadata {
  if (bytes.byteLength > CAPSULE_MAX_METADATA_BYTES) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata is too large",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata is malformed",
    );
  }
  assertMetadataShape(value, plaintextLength, true);
  const metadata: CapsuleMetadata = {
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
  };
  if (value.createdAt !== undefined) metadata.createdAt = value.createdAt;
  if (value.attributes !== undefined) {
    metadata.attributes = value.attributes as JsonObject;
  }
  return metadata;
}
