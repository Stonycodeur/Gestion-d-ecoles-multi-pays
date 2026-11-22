import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { applySecurity } from './core/security';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true, bodyParser: false });   // body parsers are installed by applySecurity (size limit + raw body for webhook signatures)
  applySecurity(app);
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('ÉcoleManager Pro API').setVersion('0.1.0').addBearerAuth().build());
  SwaggerModule.setup('docs', app, doc);
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
