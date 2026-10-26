import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { InfraModule } from "./infra/infra.module.js";
import { RegistrationsModule } from "./registrations/registrations.module.js";

@Module({
  imports: [InfraModule, HealthModule, RegistrationsModule],
})
export class AppModule {}
