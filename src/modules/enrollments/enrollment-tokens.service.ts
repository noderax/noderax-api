import { Injectable } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AUTH_CONFIG_KEY, authConfig } from '../../config';

@Injectable()
export class EnrollmentTokensService {
  constructor(private readonly configService: ConfigService) {}

  async issueEnrollmentToken(): Promise<{
    token: string;
    tokenHash: string;
    tokenLookupHash: string;
  }> {
    const token = randomBytes(32).toString('base64url');

    return {
      token,
      tokenHash: await this.hashToken(token),
      tokenLookupHash: this.createLookupHash(token),
    };
  }

  issueAgentToken(): string {
    return randomBytes(32).toString('hex');
  }

  createLookupHash(token: string): string {
    return createHmac('sha256', this.getLookupSecret())
      .update(token)
      .digest('hex');
  }

  async hashToken(token: string): Promise<string> {
    return bcrypt.hash(token, this.getSaltRounds());
  }

  async verifyToken(input: {
    token: string;
    tokenHash: string;
    tokenLookupHash: string;
  }): Promise<boolean> {
    if (!this.matchesLookupHash(input.token, input.tokenLookupHash)) {
      return false;
    }

    return bcrypt.compare(input.token, input.tokenHash);
  }

  private matchesLookupHash(token: string, expectedHash: string): boolean {
    const actualBuffer = Buffer.from(this.createLookupHash(token), 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private getLookupSecret(): string {
    const auth =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );

    return auth.jwtSecret;
  }

  private getSaltRounds(): number {
    const auth =
      this.configService.getOrThrow<ConfigType<typeof authConfig>>(
        AUTH_CONFIG_KEY,
      );

    return auth.bcryptSaltRounds;
  }
}
