import { createTransport } from 'nodemailer';
import { verifySmtpConnection } from './smtp.util';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('smtp.util', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verifies SMTP connectivity successfully', async () => {
    const verify = jest.fn().mockResolvedValue(true);
    const close = jest.fn();

    (createTransport as jest.Mock).mockReturnValue({
      verify,
      close,
    });

    await expect(
      verifySmtpConnection({
        smtpHost: 'smtp.resend.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: 'resend',
        smtpPassword: 'secret',
      }),
    ).resolves.toBeUndefined();

    expect(verify).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects blank SMTP host before verifying', async () => {
    await expect(
      verifySmtpConnection({
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: '',
        smtpPassword: '',
      }),
    ).rejects.toThrow('SMTP host is required to test email delivery.');

    expect(createTransport).not.toHaveBeenCalled();
  });

  it('closes the transporter when SMTP verification fails', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('connect timeout'));
    const close = jest.fn();

    (createTransport as jest.Mock).mockReturnValue({
      verify,
      close,
    });

    await expect(
      verifySmtpConnection({
        smtpHost: 'smtp.resend.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: 'resend',
        smtpPassword: 'secret',
      }),
    ).rejects.toThrow('connect timeout');

    expect(close).toHaveBeenCalledTimes(1);
  });
});
