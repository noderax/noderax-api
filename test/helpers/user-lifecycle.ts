import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { MailerService } from '../../src/modules/notifications/mailer.service';
import { apiPath } from './api-path';

type CreateAcceptedUserInput = {
  adminToken: string;
  email: string;
  name: string;
  role?: 'platform_admin' | 'user';
  password?: string;
};

const DEFAULT_PASSWORD = 'ChangeMe123!';

const findInvitationToken = (
  mailerService: MailerService,
  email: string,
): string => {
  const delivery = [...mailerService.getDeliveries()]
    .reverse()
    .find(
      (item) =>
        item.to.includes(email) &&
        item.subject.includes('You have been invited to Noderax'),
    );

  if (!delivery) {
    throw new Error(`No invitation email found for ${email}`);
  }

  const url = delivery.text
    .split(/\s+/)
    .find((part) => part.includes('/invite/'));

  if (!url) {
    throw new Error(`No invite URL found for ${email}`);
  }

  const token = new URL(url).pathname.split('/').filter(Boolean).at(-1);

  if (!token) {
    throw new Error(`Unable to parse invitation token for ${email}`);
  }

  return token;
};

export async function createAcceptedUser(
  app: INestApplication,
  mailerService: MailerService,
  input: CreateAcceptedUserInput,
) {
  const password = input.password ?? DEFAULT_PASSWORD;

  const created = await request(app.getHttpServer())
    .post(apiPath('/users'))
    .set('Authorization', `Bearer ${input.adminToken}`)
    .send({
      email: input.email,
      name: input.name,
      role: input.role ?? 'user',
    })
    .expect(201);

  const invitationToken = findInvitationToken(mailerService, input.email);

  await request(app.getHttpServer())
    .post(apiPath(`/auth/invitations/${invitationToken}/accept`))
    .send({ password })
    .expect(200);

  return {
    ...(created.body as {
      id: string;
      email: string;
      name: string;
      role: 'platform_admin' | 'user';
    }),
    password,
  };
}

export async function loginUser(
  app: INestApplication,
  email: string,
  password = DEFAULT_PASSWORD,
) {
  const response = await request(app.getHttpServer())
    .post(apiPath('/auth/login'))
    .send({
      email,
      password,
    })
    .expect(200);

  return response.body.accessToken as string;
}
