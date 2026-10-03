import './env.js';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.setGlobalPrefix('api');
app.use(cookieParser());
// Delivery photos come in as small data URLs, bigger than the 100kb default.
app.useBodyParser('json', { limit: '2mb' });
await app.listen(process.env.PORT ?? 4000);
