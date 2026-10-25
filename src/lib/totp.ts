import {Secret, TOTP} from 'otpauth';

export interface TotpConfig {
  type: 'totp';
  secret: string;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: 6 | 8;
  period: number;
  issuer?: string;
  accountName?: string;
}

export interface TotpCode {
  code: string;
  validUntil: number;
  period: number;
}

export const TOTP_INPUT_LIMIT_BYTES = 4096;
const INVALID_TOTP = 'Invalid TOTP configuration.';

function invalid(): never {
  throw new Error(INVALID_TOTP);
}

function normalizeSecret(input: string): string {
  const value = input.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z2-7]+={0,6}$/.test(value)) invalid();
  const bare = value.replace(/=+$/, '');
  const secret = Secret.fromBase32(bare);
  if (secret.bytes.length < 10 || secret.bytes.length > 128 || secret.base32 !== bare) invalid();
  const padding = (8 - (bare.length % 8)) % 8;
  if (value.includes('=') && value !== bare + '='.repeat(padding)) invalid();
  return bare;
}

function label(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) invalid();
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) invalid();
  }
  return value;
}

function validate(config: unknown): TotpConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) invalid();
  const item = config as Record<string, unknown>;
  if (item.type !== 'totp' || typeof item.secret !== 'string' || item.secret.length > TOTP_INPUT_LIMIT_BYTES) invalid();
  if (item.algorithm !== 'SHA1' && item.algorithm !== 'SHA256' && item.algorithm !== 'SHA512') invalid();
  if (item.digits !== 6 && item.digits !== 8) invalid();
  if (typeof item.period !== 'number' || !Number.isInteger(item.period) || item.period < 1 || item.period > 300) invalid();
  return {
    type: 'totp', secret: normalizeSecret(item.secret), algorithm: item.algorithm,
    digits: item.digits, period: item.period,
    ...(item.issuer === undefined ? {} : {issuer: label(item.issuer)}),
    ...(item.accountName === undefined ? {} : {accountName: label(item.accountName)}),
  };
}

/** Import only local seed material. All failures deliberately omit the input. */
export function parseTotpInput(input: string): TotpConfig {
  try {
    if (Buffer.byteLength(input, 'utf8') > TOTP_INPUT_LIMIT_BYTES) invalid();
    const text = input.trim();
    if (!/^otpauth:/i.test(text)) {
      return validate({type: 'totp', secret: text, algorithm: 'SHA1', digits: 6, period: 30});
    }
    if (/%(?![a-f\d]{2})/i.test(text)) invalid();
    const uri = new URL(text);
    if (uri.protocol !== 'otpauth:' || uri.hostname !== 'totp' || uri.port || uri.username || uri.password || uri.hash) invalid();
    const params = uri.searchParams;
    const allowed = new Set(['secret', 'issuer', 'algorithm', 'digits', 'period']);
    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) invalid();
    }
    const name = decodeURIComponent(uri.pathname.slice(1));
    const names = name.split(':');
    if (names.length > 2) invalid();
    const accountName = label(names.at(-1));
    const issuerFromLabel = names.length === 2 ? label(names[0]) : undefined;
    const issuerFromParam = params.has('issuer') ? label(params.get('issuer')) : undefined;
    if (issuerFromLabel !== undefined && issuerFromParam !== undefined && issuerFromLabel !== issuerFromParam) invalid();
    const period = params.get('period') ?? '30';
    const digits = params.get('digits') ?? '6';
    if (!/^[1-9]\d*$/.test(period) || !/^(6|8)$/.test(digits)) invalid();
    return validate({
      type: 'totp', secret: params.get('secret'), algorithm: (params.get('algorithm') ?? 'SHA1').toUpperCase(),
      digits: Number(digits), period: Number(period), accountName,
      ...(issuerFromParam ?? issuerFromLabel ? {issuer: issuerFromParam ?? issuerFromLabel} : {}),
    });
  } catch {
    return invalid();
  }
}

/** Legacy arbitrary .totp fields are not authenticator configurations. */
export function readTotpConfig(data: unknown): TotpConfig | undefined {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const candidate = (data as Record<string, unknown>).totp;
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate) || (candidate as Record<string, unknown>).type !== 'totp') return undefined;
  try {
    return validate(candidate);
  } catch {
    return invalid();
  }
}

export function generateTotpCode(config: TotpConfig, timestamp = Date.now()): TotpCode {
  try {
    const value = validate(config);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) invalid();
    const code = TOTP.generate({...value, secret: Secret.fromBase32(value.secret), timestamp});
    return {code, validUntil: (Math.floor(timestamp / (value.period * 1000)) + 1) * value.period * 1000, period: value.period};
  } catch {
    return invalid();
  }
}
