// Path: src/commands/secret/raw-value.ts

/**
 * Raw value selection for `secret decrypt --raw` / `--field`.
 *
 * Pure: turns a decrypted `data` payload into the single thing that should be
 * written to stdout (or to `-o <file>`), with no metadata around it. Used to
 * feed env vars (`export X=$(znvault secret decrypt ... --raw)`) and files
 * (`... --raw > key.pem`).
 */

/** What to emit: text (a string, written as-is) or bytes (a decoded file). */
export type RawPayload =
  | { kind: 'text'; value: string }
  | { kind: 'bytes'; value: Buffer };

/** Thrown when the payload cannot be reduced to one value (caller decides the message sink). */
export class RawSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawSelectionError';
  }
}

/** A file-based secret (or file-shaped field) stores `{ filename, content(base64) }`. */
export interface FileShaped {
  filename: string;
  content: string;
}

/** True for `{ filename: string, content: string }` payloads (file secrets, keypair halves). */
export function isFileShaped(value: unknown): value is FileShaped {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).filename === 'string' &&
    typeof (value as Record<string, unknown>).content === 'string'
  );
}

function render(value: unknown): RawPayload {
  if (typeof value === 'string') return { kind: 'text', value };
  if (isFileShaped(value)) return { kind: 'bytes', value: Buffer.from(value.content, 'base64') };
  return { kind: 'text', value: JSON.stringify(value) };
}

/**
 * Pick the raw value out of a decrypted payload.
 *
 * - With `field`: that own property of `data` (strings verbatim, file-shaped
 *   objects decoded to bytes, anything else as compact JSON).
 * - Without `field`: a file-based secret decodes to bytes; a one-key payload
 *   (`{ text }`, `{ value }`, resolved link) yields that key's value; anything
 *   with several fields is refused — the caller must name one with `--field`.
 *
 * @throws RawSelectionError when the payload is missing/empty, the field is
 *   unknown, or the payload is ambiguous without a field.
 */
export function selectRawValue(
  data: Record<string, unknown> | undefined | null,
  field?: string,
): RawPayload {
  if (data === undefined || data === null || typeof data !== 'object') {
    throw new RawSelectionError('Secret has no data payload');
  }

  const keys = Object.keys(data);

  if (field !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      throw new RawSelectionError(
        `Field '${field}' not found in secret data (available: ${keys.join(', ') || 'none'})`,
      );
    }
    return render(data[field]);
  }

  if (isFileShaped(data)) return render(data);

  if (keys.length === 0) {
    throw new RawSelectionError('Secret data is empty');
  }
  if (keys.length > 1) {
    throw new RawSelectionError(
      `Secret has multiple fields (${keys.join(', ')}); use --field <name> to select one`,
    );
  }
  return render(data[keys[0]]);
}
