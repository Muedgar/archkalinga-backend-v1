import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── Security headers (helmet) ─────────────────────────────────────────────
  // Sets X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,
  // X-XSS-Protection, Content-Security-Policy, Referrer-Policy, etc.
  app.use(
    helmet({
      // Allow Swagger UI to load its own scripts/styles in development
      contentSecurityPolicy: process.env.NODE_ENV === 'production',
      crossOriginEmbedderPolicy: process.env.NODE_ENV === 'production',
    }),
  );

  // ── CORS — explicit origin allowlist ─────────────────────────────────────
  // ALLOWED_ORIGINS: comma-separated list, e.g. "https://app.archkalinga.com"
  // Falls back to CLIENT_URL, then denies all cross-origin requests.
  const rawOrigins =
    process.env.ALLOWED_ORIGINS ?? process.env.CLIENT_URL ?? '';

  const allowedOrigins: string[] = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!requestOrigin) return callback(null, true);

      if (
        process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/localhost(:\d+)?$/.test(requestOrigin)
      ) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(requestOrigin)) return callback(null, true);
      callback(new Error(`CORS: origin "${requestOrigin}" is not allowed`));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id'],
    credentials: true,
  });

  // ── Global validation ─────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ── Swagger (non-production only, or always if you prefer) ────────────────
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ArchKalinga API')
      .setDescription('Project and construction workflow platform')
      .setVersion('1.2.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.SERVER_PORT ?? process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`\n🚀  ArchKalinga API running on http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📖  Swagger docs at  http://localhost:${port}/api/docs\n`);
  }
}

bootstrap();
