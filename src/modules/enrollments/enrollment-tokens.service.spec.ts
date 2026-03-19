import { ConfigService } from '@nestjs/config';
import { EnrollmentTokensService } from './enrollment-tokens.service';

function createConfigService(): ConfigService {
  return {
    getOrThrow: jest.fn().mockReturnValue({
      jwtSecret: 'test-secret',
      bcryptSaltRounds: 10,
    }),
  } as unknown as ConfigService;
}

describe('EnrollmentTokensService', () => {
  let service: EnrollmentTokensService;

  beforeEach(() => {
    service = new EnrollmentTokensService(createConfigService());
  });

  it('issues verifiable enrollment tokens with a deterministic lookup hash', async () => {
    const issued = await service.issueEnrollmentToken();

    expect(issued.token).toEqual(expect.any(String));
    expect(issued.tokenHash).toEqual(expect.any(String));
    expect(issued.tokenLookupHash).toBe(service.createLookupHash(issued.token));

    await expect(
      service.verifyToken({
        token: issued.token,
        tokenHash: issued.tokenHash,
        tokenLookupHash: issued.tokenLookupHash,
      }),
    ).resolves.toBe(true);
  });

  it('rejects invalid enrollment tokens during verification', async () => {
    const issued = await service.issueEnrollmentToken();

    await expect(
      service.verifyToken({
        token: 'wrong-token',
        tokenHash: issued.tokenHash,
        tokenLookupHash: issued.tokenLookupHash,
      }),
    ).resolves.toBe(false);
  });
});
