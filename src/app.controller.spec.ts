import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisService } from './redis/redis.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DataSource,
          useValue: {
            isInitialized: true,
            query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
            showMigrations: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: RedisService,
          useValue: {
            isEnabled: jest.fn().mockReturnValue(false),
            ping: jest.fn().mockResolvedValue(true),
            getHealthSnapshot: jest.fn().mockReturnValue({
              enabled: false,
              status: 'disabled',
              subscriberStatus: 'disabled',
              instanceId: 'test',
            }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return the API health payload', () => {
      expect(appController.getHealth()).toMatchObject({
        service: 'noderax-api',
        status: 'ok',
      });
      expect(appController.getHealth().startedAt).toEqual(expect.any(String));
      expect(appController.getHealth().bootId).toEqual(expect.any(String));
    });
  });
});
