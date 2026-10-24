// Shared with the site (copied as-is to web/src/lib/protocol.ts). Binary messages, encoded
// with lib0/encoding; the first varUint is the message type.

export const MSG = {
  /** y-protocols/sync payload (open pads only). */
  SYNC: 0,
  /** server→client: varUint count. */
  PRESENCE: 1,
  /** client→server and server→others: varUint8Array data. */
  ENC_UPDATE: 2,
  /** server→client: varUint8Array snapshot (empty if none), varUint n, n × varUint8Array. */
  ENC_INIT: 3,
  /** server→client: varUint upToSeq. */
  COMPACT_REQ: 4,
  /** client→server: varUint upToSeq, varUint8Array data. */
  ENC_SNAPSHOT: 5,
} as const;

export const CLOSE = {
  INVALID_NAME: 4400,
  UNAUTHORIZED: 4401,
  KEY_CHANGED: 4409,
  TOO_LARGE: 4413,
} as const;
