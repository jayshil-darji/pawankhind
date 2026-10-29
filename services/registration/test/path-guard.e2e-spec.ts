import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { httpAdapter } from "../src/http-options.js";
import { testConfig } from "./support/config.js";

// CloudFront picks a behaviour (and the /api/admin* gate) from the raw path; Fastify routes on the
// decoded one. Requests go over a real socket: app.inject() normalises dot segments in its own
// URL parsing, so it would hide /./ and %2e paths from the guard and show routes they never reach.

/** Handler runs, so a test can prove a rejected request never reached a route. */
let handled = 0;

@Controller("api")
class StubController {
  @Get("admin/ping")
  ping() {
    handled += 1;
    return { reached: "admin" };
  }

  @Get("registrations/:id/status")
  status(@Param("id") id: string) {
    handled += 1;
    return { reached: "status", id };
  }

  @Post("webhooks/razorpay")
  @HttpCode(200)
  webhook() {
    return { reached: "webhook" };
  }
}

let app: NestFastifyApplication;
let port: number;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [StubController] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    httpAdapter(testConfig({ TRUST_PROXY: "1" })),
  );
  await app.listen(0, "127.0.0.1");
  port = (app.getHttpServer().address() as AddressInfo).port;
});

afterAll(async () => {
  await app?.close();
});

/** Sends the path exactly as given (Node's http client does not normalise it). */
function send(method: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const UUID = "3f2b8c1e-0d4a-4c3e-9b7a-2f1e0d9c8b7a";

describe("path guard", () => {
  // Before the guard, /api/%61dmin/ping reached the admin route over a real socket.
  it.each([
    "/api/%61dmin/ping",
    "/api/%2e/admin/ping",
    "/api//admin/ping",
    "/api/./admin/ping",
    "/api/x/../admin/ping",
    "/api/admin%2Fping",
    "/api\\admin/ping",
    `/api/registrations/${UUID}/%73tatus`,
  ])("answers 400 invalid_path for %s and runs no handler", async (path) => {
    const before = handled;

    const res = await send("GET", path);

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ code: "invalid_path" });
    // Give a handler that slipped through time to run after the reply.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handled).toBe(before);
  });

  it("does not route a different-case path to the admin route", async () => {
    expect((await send("GET", "/API/admin/ping")).status).toBe(404);
  });

  it("lets normal paths through", async () => {
    expect(await send("GET", "/api/admin/ping")).toMatchObject({ status: 200 });
    expect(JSON.parse((await send("GET", `/api/registrations/${UUID}/status`)).body)).toEqual({
      reached: "status",
      id: UUID,
    });
    expect(JSON.parse((await send("POST", "/api/webhooks/razorpay")).body)).toEqual({
      reached: "webhook",
    });
  });

  it("leaves query strings alone, percent-escapes included", async () => {
    const res = await send("GET", `/api/registrations/${UUID}/status?note=a%20b&next=/x//y`);

    expect(res.status).toBe(200);
  });
});
