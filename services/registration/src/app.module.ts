import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { InfraModule } from "./infra/infra.module.js";

@Module({
    imports: [InfraModule, HealthModule],
})
export class AppModule {}