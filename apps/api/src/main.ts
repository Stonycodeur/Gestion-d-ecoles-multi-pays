import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpAdapterHost } from '@nestjs/core';
import { productionProblems } from './core/production-config';
import { applySecurity } from './core/security';
import { SentryExceptionFilter } from './core/sentry';

async function bootstrap() {
  const problems = productionProblems();
  if (problems.length) { for (const m of problems) console.error(`[config] ${m}`); throw new Error(`refusing to start: ${problems.length} production configuration problem(s)`); }
  const app = await NestFactory.create(AppModule, { rawBody: true, bodyParser: false });   // body parsers are installed by applySecurity (size limit + raw body for webhook signatures)
  applySecurity(app);
  if (process.env.SENTRY_DSN) app.useGlobalFilters(new SentryExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('ÉcoleManager Pro API').setVersion('0.1.0').addBearerAuth().build());
  SwaggerModule.setup('docs', app, doc);
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
