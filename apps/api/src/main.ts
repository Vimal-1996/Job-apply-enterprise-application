import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

async function bootstrap() {
  const config = loadConfig(); // fail fast if Cognito settings are missing
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: false });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

bootstrap();
