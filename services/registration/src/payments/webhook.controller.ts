import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Post,
  Req,
  type RawBodyRequest,
} from "@nestjs/common";
import { RegistrationFlow } from "../registrations/registration-flow.service.js";

@Controller("api/webhooks")
export class WebhookController {
  constructor(private readonly flow: RegistrationFlow) {}

  @Post("razorpay")
  @HttpCode(200)
  async razorpay(
    @Req() req: RawBodyRequest<object>,
    @Headers("x-razorpay-signature") signature: string | undefined,
  ) {
    const outcome = await this.flow.handleWebhook(req.rawBody, signature);
    switch (outcome.kind) {
      case "bad_signature":
      case "bad_payload":
        throw new HttpException({ code: outcome.kind }, 400);
      case "pending":
        throw new HttpException({ code: "pending" }, 503); // ask Razorpay to retry
      default:
        return { received: true };
    }
  }
}
