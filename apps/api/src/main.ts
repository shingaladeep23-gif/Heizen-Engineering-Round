import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

try {
  process.loadEnvFile(); // local .env; in production the host sets real env vars
} catch {}

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api');
app.use(cookieParser());
await app.listen(process.env.PORT ?? 4000);
