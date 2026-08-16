import type { Readable } from 'node:stream';

export const DEFAULT_STDIN_LIMIT_BYTES = 1024 * 1024;

/**
 * Read a bounded UTF-8 stream without ever materializing its value in argv or
 * on disk. The byte limit is checked against UTF-8 bytes, not JavaScript code
 * units, so multibyte input cannot bypass it.
 */
export async function readUtf8Stream(
  input: Readable,
  maxBytes = DEFAULT_STDIN_LIMIT_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new Error(`stdin exceeds the ${maxBytes}-byte safety limit`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

/** Read piped stdin and fail immediately instead of waiting on a terminal. */
export async function readStdinUtf8(
  maxBytes = DEFAULT_STDIN_LIMIT_BYTES,
): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('stdin is a terminal; pipe JSON into --data-stdin');
  }

  return readUtf8Stream(process.stdin, maxBytes);
}
