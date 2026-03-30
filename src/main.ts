import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  DocumentBuilder,
  SwaggerCustomOptions,
  SwaggerModule,
} from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SWAGGER_BEARER_AUTH_NAME } from './common/constants/swagger.constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { APP_CONFIG_KEY, appConfig } from './config';
import { normalizeDatabaseEnvAliases } from './config/database-env.utils';
import { prepareBootEnvironment } from './install/boot-mode';
import { readInstallState } from './install/install-state';
import { SetupAppModule } from './setup-app.module';

async function bootstrap() {
  normalizeDatabaseEnvAliases();

  const installState = readInstallState();
  const bootMode = await prepareBootEnvironment(installState);
  const rootModule = bootMode === 'setup' ? SetupAppModule : AppModule;

  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    bufferLogs: true,
  });

  app.use(helmet());
  app.use(compression());
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '50mb' });

  const configService = app.get(ConfigService);
  const appSettings =
    configService.getOrThrow<ConfigType<typeof appConfig>>(APP_CONFIG_KEY);
  const logger = new Logger('Bootstrap');
  const { apiPrefix, corsOrigin, port, swaggerEnabled, swaggerPath } =
    appSettings;

  if (apiPrefix) {
    app.setGlobalPrefix(apiPrefix, {
      exclude: [
        {
          path: 'health',
          method: RequestMethod.GET,
        },
        {
          path: `${apiPrefix}/health`,
          method: RequestMethod.GET,
        },
      ],
    });
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

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Noderax API')
      .setDescription(
        'Agent-based infrastructure, package management, and two-step agent enrollment platform. All HTTP endpoints are exposed under /api/v1.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Paste a JWT access token to authorize protected endpoints.',
          in: 'header',
        },
        SWAGGER_BEARER_AUTH_NAME,
      )
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig, {
      deepScanRoutes: true,
      operationIdFactory: (_controllerKey, methodKey) => methodKey,
    });

    const swaggerOptions: SwaggerCustomOptions = {
      customSiteTitle: 'Noderax API Docs',
      useGlobalPrefix: Boolean(apiPrefix),
      jsonDocumentUrl: `${swaggerPath}-json`,
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
        docExpansion: 'none',
      },
    };

    SwaggerModule.setup(swaggerPath, app, swaggerDocument, swaggerOptions);
  }

  await app.listen(port, '0.0.0.0');
  const publicBaseUrl = normalizePublicBaseUrl(await app.getUrl());
  const apiBaseUrl = buildPublicUrl(publicBaseUrl, apiPrefix);

  logger.log(`Noderax API listening at ${apiBaseUrl}`);
  if (bootMode === 'setup') {
    logger.log('Installer setup mode is active');
  }
  if (swaggerEnabled) {
    logger.log(
      `Swagger UI available at ${buildPublicUrl(publicBaseUrl, apiPrefix, swaggerPath)}`,
    );
    logger.log(
      `OpenAPI JSON available at ${buildPublicUrl(publicBaseUrl, apiPrefix, `${swaggerPath}-json`)}`,
    );
  }
}

function normalizePublicBaseUrl(url: string): string {
  const parsedUrl = new URL(url);

  if (['[::1]', '::1', '127.0.0.1', '0.0.0.0'].includes(parsedUrl.hostname)) {
    parsedUrl.hostname = 'localhost';
  }

  return parsedUrl.toString().replace(/\/$/, '');
}

function buildPublicUrl(baseUrl: string, ...segments: string[]): string {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const normalizedPath = segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .join('/');

  url.pathname = normalizedPath ? `/${normalizedPath}` : '/';

  return url.toString().replace(/\/$/, '');
}

bootstrap();
