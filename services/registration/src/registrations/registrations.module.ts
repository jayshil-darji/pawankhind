import { Module } from "@nestjs/common";
import pg from "pg";
import { Config } from "../config.js";
import { APP_CONFIG, PAYMENT_PROVIDER, PG_POOL } from "../infra/tokens.js";
import { PaymentsRepository } from "../payments/payments.repository.js";
import type { PaymentProvider } from "../payments/payment-provider.js";
import { RazorpayProvider } from "../payments/razorpay.provider.js";
import { RegistrationFlow } from "./registration-flow.service.js";
import { RegistrationsController } from "./registrations.controller.js";
import { RegistrationsRepository } from "./registrations.repository.js";
import { WebhookController } from "../payments/webhook.controller.js";
import { HoldSweeper } from "./hold-sweeper.js";
import { ReconciliationJob } from "../payments/reconciliation.job.js";

const SWEEP_INTERVAL_MS = 60_000;
const RECONCILE_INTERVAL_MS = 10 * 60_000;
const RECONCILE_LOOKBACK_SECONDS = 48 * 3600;

@Module({
  controllers: [RegistrationsController, WebhookController],
  providers: [
    {
      provide: RegistrationsRepository,
      useFactory: (pool: pg.Pool) => new RegistrationsRepository(pool),
      inject: [PG_POOL],
    },
    {
      provide: PaymentsRepository,
      useFactory: (pool: pg.Pool) => new PaymentsRepository(pool),
      inject: [PG_POOL],
    },
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (config: Config) =>
        new RazorpayProvider({
          keyId: config.RAZORPAY_KEY_ID,
          keySecret: config.RAZORPAY_KEY_SECRET,
          webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: RegistrationFlow,
      useFactory: (r: RegistrationsRepository, p: PaymentsRepository, provider: PaymentProvider) =>
        new RegistrationFlow(r, p, provider),
      inject: [RegistrationsRepository, PaymentsRepository, PAYMENT_PROVIDER],
    },
    {
      provide: HoldSweeper,
      useFactory: (r: RegistrationsRepository) => new HoldSweeper(r, SWEEP_INTERVAL_MS),
      inject: [RegistrationsRepository],
    },
    {
      provide: ReconciliationJob,
      useFactory: (
        flow: RegistrationFlow,
        payments: PaymentsRepository,
        provider: PaymentProvider,
      ) =>
        new ReconciliationJob(
          flow,
          payments,
          provider,
          RECONCILE_INTERVAL_MS,
          RECONCILE_LOOKBACK_SECONDS,
        ),
      inject: [RegistrationFlow, PaymentsRepository, PAYMENT_PROVIDER],
    },
  ],
})
export class RegistrationsModule {}
