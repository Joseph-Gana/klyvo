const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bytesToUuid(bytes: Uint8Array): string {
  // Set RFC 4122 version (4) and variant (10xx) bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generates an RFC 4122 version 4 UUID using crypto.randomUUID() when available,
 * falling back to crypto.getRandomValues() or Math.random() in legacy environments.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return bytesToUuid(bytes);
    }
  }

  const fallbackBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    fallbackBytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToUuid(fallbackBytes);
}

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function isUuidV4(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}
