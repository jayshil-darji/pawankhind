import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("./gate.js", import.meta.url), "utf8");
const REALM = "Pawankhind dev";
// A fake password for these tests only; the real one is the Terraform variable gate_password.
const TOKEN = Buffer.from("organizer:test-only-password").toString("base64");
const RIGHT = `Basic ${TOKEN}`;

/** Loads the function the way Terraform deploys it: placeholders replaced, run as a script. */
function loadHandler() {
  const code = SOURCE.replace("__GATE_TOKEN__", TOKEN).replace("__GATE_REALM__", REALM);
  return vm.runInNewContext(`${code}\nhandler;`, {});
}

const handler = loadHandler();

function viewerRequest(uri, authorization) {
  const headers = { host: { value: "dxxxx.cloudfront.net" } };
  if (authorization !== undefined) headers.authorization = { value: authorization };
  return { request: { method: "GET", uri, querystring: {}, headers, cookies: {} } };
}

function assertChallenge(result) {
  assert.equal(result.statusCode, 401);
  assert.equal(result.headers["www-authenticate"].value, `Basic realm="${REALM}"`);
  assert.equal(result.uri, undefined, "a response, not a request: the origin is never called");
}

describe("gate function", () => {
  it("challenges a request without credentials, with the shared realm", () => {
    assertChallenge(handler(viewerRequest("/")));
  });

  it("uses the same challenge on the site, /admin and /api/admin", () => {
    const challenges = ["/", "/admin", "/api/admin/ping"].map(
      (uri) => handler(viewerRequest(uri)).headers["www-authenticate"].value,
    );

    assert.deepEqual(challenges, Array(3).fill(`Basic realm="${REALM}"`));
  });

  it("challenges a wrong password", () => {
    const wrong = `Basic ${Buffer.from("organizer:wrong").toString("base64")}`;

    assertChallenge(handler(viewerRequest("/admin", wrong)));
  });

  it("passes a request with the right credentials through", () => {
    const event = viewerRequest("/assets/index-abc123.js", RIGHT);

    const result = handler(event);

    assert.equal(result, event.request);
    assert.equal(result.uri, "/assets/index-abc123.js");
  });

  it("challenges /api/admin without credentials, so the origin never sees it", () => {
    for (const uri of ["/api/admin", "/api/admin/ping", "/api/admin/registrations"]) {
      assertChallenge(handler(viewerRequest(uri)));
    }
  });

  it("removes the gate credentials before an /api/admin request goes to the origin", () => {
    const result = handler(viewerRequest("/api/admin/ping", RIGHT));

    assert.equal(result.uri, "/api/admin/ping", "API paths are never rewritten");
    assert.equal(result.headers.authorization, undefined);
    assert.equal(result.headers.host.value, "dxxxx.cloudfront.net");
  });

  it("never gates the public API or the Razorpay webhook", () => {
    for (const uri of ["/api/webhooks/razorpay", "/api/registrations", "/api/payments/verify"]) {
      const event = viewerRequest(uri);

      const result = handler(event);

      assert.equal(result, event.request, uri);
      assert.equal(result.uri, uri);
    }
  });

  it("rewrites extensionless site and admin paths to /index.html", () => {
    for (const uri of ["/", "/registration/abc-123", "/terms", "/admin", "/admin/kit"]) {
      assert.equal(handler(viewerRequest(uri, RIGHT)).uri, "/index.html", uri);
    }
  });

  it("challenges malformed Authorization headers without throwing", () => {
    const malformed = [
      "",
      "Basic",
      "Basic ",
      "Basic !!!not-base64!!!",
      "Bearer abc",
      `basic ${TOKEN}`,
      `${RIGHT} `,
      "Basic " + "A".repeat(10000),
    ];
    for (const value of malformed) {
      assertChallenge(handler(viewerRequest("/admin", value)));
    }

    const noValue = viewerRequest("/admin");
    noValue.request.headers.authorization = {};
    assertChallenge(handler(noValue));
  });

  it("contains each placeholder exactly once, so Terraform's replace() cannot miss one", () => {
    for (const placeholder of ["__GATE_TOKEN__", "__GATE_REALM__"]) {
      assert.equal(SOURCE.split(placeholder).length - 1, 1, placeholder);
    }
  });
});
