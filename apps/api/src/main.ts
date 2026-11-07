import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

async function bootstrap() {
  const config = loadConfig(); // fail fast if Cognito or database settings are missing
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind CloudFront + the load balancer, the client IP is in X-Forwarded-For;
  // trust exactly that many hops so it can't be spoofed by the client.
  if (config.trustProxyHops) app.set('trust proxy', config.trustProxyHops);
  if (config.basePath) app.setGlobalPrefix(config.basePath);
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: false });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

bootstrap();
