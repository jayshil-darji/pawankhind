import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { participantSchema, registrationIdSchema, verifyPaymentSchema } from "@pawankhind/schemas";
import type { z } from "zod";
import { APP_CONFIG } from "../infra/tokens.js";
import type { Config } from "../config.js";
import { RegistrationFlow } from "./registration-flow.service.js";
import { RegistrationsRepository } from "./registrations.repository.js";

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException({
      code: "invalid_request",
      issues: result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

@Controller("api")
export class RegistrationsController {
  constructor(
    private readonly flow: RegistrationFlow,
    private readonly registrations: RegistrationsRepository,
    @Inject(APP_CONFIG) private readonly config: Config,
  ) {}

  @Post("registrations")
  async start(@Body() body: unknown) {
    const participant = parse(participantSchema, body);
    const result = await this.flow.start(participant);

    if (!result.ok) {
      const status = result.reason === "closed" || result.reason === "no_event" ? 403 : 409;
      throw new HttpException({ code: result.reason }, status);
    }
    return {
      registrationId: result.registrationId,
      holdExpiresAt: result.holdExpiresAt,
      resumed: result.resumed,
      checkout: {
        keyId: this.config.RAZORPAY_KEY_ID,
        orderId: result.order.orderId,
        amountPaise: result.order.amountPaise,
        currency: result.order.currency,
      },
    };
  }

  @Post("payments/verify")
  @HttpCode(200)
  async verify(@Body() body: unknown) {
    const input = parse(verifyPaymentSchema, body);
    const outcome = await this.flow.verify({
      registrationId: input.registrationId,
      paymentId: input.razorpayPaymentId,
      signature: input.razorpaySignature,
    });

    switch (outcome.kind) {
      case "confirmed":
        return { status: "confirmed", bib: outcome.bib };
      case "pending":
        return { status: "pending" };
      case "bad_signature":
        throw new HttpException({ code: "bad_signature" }, 400);
      case "unknown":
        throw new HttpException({ code: "unknown_registration" }, 404);
      case "mismatch":
        throw new HttpException({ code: "payment_mismatch" }, 422);
      case "needs_support":
        throw new HttpException(
          {
            code: "needs_support",
            message:
              "Payment received but registration could not be completed. Contact the organisers.",
          },
          409,
        );
    }
  }

  @Get("registrations/:id/status")
  async status(@Param("id") id: string) {
    const parsed = registrationIdSchema.safeParse(id);
    if (!parsed.success) throw new NotFoundException();
    const found = await this.registrations.getPublicStatus(parsed.data);
    if (!found) throw new NotFoundException();
    return found.status === "confirmed"
      ? { status: "confirmed", bib: found.bib }
      : { status: found.status };
  }
}
