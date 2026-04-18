import { createTransport } from 'nodemailer';
import { createSmtpTransporter } from '../../common/utils/smtp.util';
import { MailerService } from './mailer.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

jest.mock('../../common/utils/smtp.util', () => ({
  createSmtpTransporter: jest.fn(),
}));

describe('MailerService', () => {
  let configService: { getOrThrow: jest.Mock };
  let service: MailerService;

  beforeEach(() => {
    configService = {
      getOrThrow: jest.fn(),
    };
    service = new MailerService(configService as never);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('rebuilds the SMTP transporter after runtime mail settings change', async () => {
    const firstTransporter = {
      sendMail: jest.fn().mockResolvedValue({}),
      close: jest.fn(),
    };
    const secondTransporter = {
      sendMail: jest.fn().mockResolvedValue({}),
      close: jest.fn(),
    };

    configService.getOrThrow
      .mockReturnValueOnce({
        jsonTransport: false,
        smtpHost: 'smtp-1.example.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: 'user-1',
        smtpPassword: 'pass-1',
        fromEmail: 'alerts@example.com',
        fromName: 'Noderax',
      })
      .mockReturnValueOnce({
        jsonTransport: false,
        smtpHost: 'smtp-1.example.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: 'user-1',
        smtpPassword: 'pass-1',
        fromEmail: 'alerts@example.com',
        fromName: 'Noderax',
      })
      .mockReturnValueOnce({
        jsonTransport: false,
        smtpHost: 'smtp-2.example.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: 'user-2',
        smtpPassword: 'pass-2',
        fromEmail: 'alerts@example.com',
        fromName: 'Noderax',
      })
      .mockReturnValueOnce({
        jsonTransport: false,
        smtpHost: 'smtp-2.example.com',
        smtpPort: 587,
        smtpSecure: false,
        smtpUsername: 'user-2',
        smtpPassword: 'pass-2',
        fromEmail: 'alerts@example.com',
        fromName: 'Noderax',
      });

    (createSmtpTransporter as jest.Mock)
      .mockReturnValueOnce(firstTransporter)
      .mockReturnValueOnce(secondTransporter);

    await service.sendMail({
      to: ['admin@example.com'],
      subject: 'First',
      text: 'hello',
    });
    await service.sendMail({
      to: ['admin@example.com'],
      subject: 'Second',
      text: 'hello again',
    });

    expect(createSmtpTransporter).toHaveBeenCalledTimes(2);
    expect(firstTransporter.close).toHaveBeenCalledTimes(1);
    expect(secondTransporter.sendMail).toHaveBeenCalledTimes(1);
  });

  it('reuses the same transporter when settings stay the same', async () => {
    const transporter = {
      sendMail: jest.fn().mockResolvedValue({}),
      close: jest.fn(),
    };

    configService.getOrThrow.mockReturnValue({
      jsonTransport: true,
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpUsername: '',
      smtpPassword: '',
      fromEmail: 'alerts@example.com',
      fromName: 'Noderax',
    });

    (createTransport as jest.Mock).mockReturnValue(transporter);

    await service.sendMail({
      to: ['admin@example.com'],
      subject: 'First',
      text: 'hello',
    });
    await service.sendMail({
      to: ['admin@example.com'],
      subject: 'Second',
      text: 'hello again',
    });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(transporter.close).not.toHaveBeenCalled();
    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
  });
});
