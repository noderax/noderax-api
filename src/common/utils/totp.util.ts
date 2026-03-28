import { createHmac, randomBytes } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_WINDOW = 1;

const encodeBase32 = (buffer: Buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

const decodeBase32 = (input: string) => {
  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      continue;
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

const hotp = (secret: string, counter: number, digits = DEFAULT_DIGITS) => {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    10 ** digits;

  return code.toString().padStart(digits, '0');
};

const normalizeToken = (token: string) => token.replace(/\s+/g, '').trim();

export const generateTotpSecret = () => encodeBase32(randomBytes(20));

export const buildTotpOtpauthUrl = (input: {
  issuer: string;
  accountName: string;
  secret: string;
}) => {
  const label = encodeURIComponent(`${input.issuer}:${input.accountName}`);
  const issuer = encodeURIComponent(input.issuer);
  const secret = encodeURIComponent(input.secret);

  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DEFAULT_DIGITS}&period=${STEP_SECONDS}`;
};

export const verifyTotpToken = (input: {
  secret: string;
  token: string;
  window?: number;
  time?: number;
}) => {
  const token = normalizeToken(input.token);
  if (!/^\d{6}$/.test(token)) {
    return false;
  }

  const time = input.time ?? Date.now();
  const counter = Math.floor(time / 1000 / STEP_SECONDS);
  const window = input.window ?? DEFAULT_WINDOW;

  for (let drift = -window; drift <= window; drift += 1) {
    if (hotp(input.secret, counter + drift) === token) {
      return true;
    }
  }

  return false;
};

export const generateRecoveryCodes = (count = 8) =>
  Array.from({ length: count }, () =>
    randomBytes(5).toString('hex').toUpperCase(),
  );
