import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const apiPrefix = configService.get<string>('app.apiPrefix');
  const port = configService.get<number>('app.port', 3000);
  const corsOrigin = configService.get<string>('app.corsOrigin', '*');

  if (apiPrefix) {
    app.setGlobalPrefix(apiPrefix);
  }

  app.enableCors({
    origin:
      corsOrigin === '*'
        ? true
        : corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(
    `Noderax API listening on port ${port}${apiPrefix ? ` with prefix /${apiPrefix}` : ''}`,
  );
}

bootstrap();
