import { NestFactory } from "@nestjs/core";
import { loadConfig } from "./config.js";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  app.enableShutdownHooks();

  await app.listen(config.PORT, config.HOST);
}

await bootstrap();
