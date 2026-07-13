export const CAPSULE_MAGIC = "ZDCP";
export const CAPSULE_VERSION = 1;
export const CAPSULE_SUITE = 1;

export const CAPSULE_FIXED_HEADER_BYTES = 68;
export const CAPSULE_FLAG_OWNER_RECOVERY = 0x0001;
export const CAPSULE_KNOWN_FLAGS = CAPSULE_FLAG_OWNER_RECOVERY;
export const CAPSULE_RECIPIENT_ALGORITHM_RSA_OAEP_256 = 1;

export const CAPSULE_IV_BYTES = 12;
export const CAPSULE_RECOVERY_SALT_BYTES = 16;
export const CAPSULE_GCM_TAG_BYTES = 16;
export const CAPSULE_OWNER_WRAP_BYTES = 40;
export const CAPSULE_FINGERPRINT_BYTES = 32;
export const CAPSULE_RECIPIENT_FIXED_BYTES = 39;

export const CAPSULE_MAX_RECIPIENTS = 64;
export const CAPSULE_MAX_HEADER_BYTES = 64 * 1024;
export const CAPSULE_MAX_METADATA_BYTES = 64 * 1024;

export const OWNER_KEY_INFO = new TextEncoder().encode(
  "zerodrive:capsule:v1:owner-key-wrap",
);
