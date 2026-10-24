import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { env } from './config/env';

/** Shared by main.ts and e2e tests so both run the same app configuration. */
export function configureApp(app: NestExpressApplication): void {
  app.use(helmet());
  app.enableCors({ origin: env.corsOrigins });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // base64url inflates ~1.4x; the extra 16 KB covers the JSON envelope.
  app.useBodyParser('json', { limit: Math.ceil((env.maxPadSizeKb * 1.4 + 16) * 1024) });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('FoculessPad API')
    .setDescription('Real-time notepad with optional end-to-end encrypted passwords.')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
