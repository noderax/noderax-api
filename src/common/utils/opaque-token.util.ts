import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

export const createOpaqueTokenLookupHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const hashOpaqueToken = (token: string, saltRounds: number) =>
  bcrypt.hash(token, saltRounds);

export const verifyOpaqueToken = async (input: {
  token: string;
  tokenHash: string;
  tokenLookupHash: string;
}) => {
  if (createOpaqueTokenLookupHash(input.token) !== input.tokenLookupHash) {
    return false;
  }

  return bcrypt.compare(input.token, input.tokenHash);
};

export const issueOpaqueToken = async (saltRounds: number) => {
  const token = randomBytes(32).toString('base64url');

  return {
    token,
    tokenHash: await hashOpaqueToken(token, saltRounds),
    tokenLookupHash: createOpaqueTokenLookupHash(token),
  };
};
