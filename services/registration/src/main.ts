import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { describePaymentMode, loadConfig } from "./config.js";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { fastifyOptions } from "./http-options.js";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(fastifyOptions(config)),
    {
      rawBody: true,
    },
  );
  app.enableShutdownHooks();
  Logger.log(describePaymentMode(config), "Bootstrap");

  await app.listen(config.PORT, config.HOST);
}

await bootstrap();
