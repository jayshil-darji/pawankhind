import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Static checks on the CloudFront behaviours in infra/envs/dev/web.tf: which paths carry the
// gate, in which order, with which headers policy. terraform plan is the full check; these catch
// the mistakes that would silently ungate admin or gate the webhook.

const WEB_TF = readFileSync(new URL("../envs/dev/web.tf", import.meta.url), "utf8");

/** The body of every `<name> {` block, in file order (brace matching; no braces in strings here). */
function blocks(text, name) {
  const found = [];
  const opener = new RegExp(`^\\s*${name}\\s*\\{`, "gm");
  let match;
  while ((match = opener.exec(text))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (depth > 0 && i < text.length) {
      if (text[i] === "{") depth += 1;
      if (text[i] === "}") depth -= 1;
      i += 1;
    }
    found.push(text.slice(match.index + match[0].length, i - 1));
  }
  return found;
}

const behaviours = blocks(WEB_TF, "ordered_cache_behavior").map((body) => ({
  path: /path_pattern\s*=\s*"([^"]+)"/.exec(body)?.[1],
  gated: /function_arn\s*=\s*aws_cloudfront_function\.gate\.arn/.test(body),
  headers:
    /response_headers_policy_id\s*=\s*aws_cloudfront_response_headers_policy\.web\["(\w+)"\]/.exec(
      body,
    )?.[1],
}));
const byPath = Object.fromEntries(behaviours.map((b) => [b.path, b]));
const [defaultBehaviour] = blocks(WEB_TF, "default_cache_behavior");

describe("CloudFront behaviours (web.tf)", () => {
  it("puts /api/admin* before /api/*, since the first matching behaviour wins", () => {
    const order = behaviours.map((b) => b.path);

    assert.ok(order.includes("/api/admin*"), "an /api/admin* behaviour exists");
    assert.ok(order.indexOf("/api/admin*") < order.indexOf("/api/*"), order.join(", "));
  });

  it("gates the site, /admin* and /api/admin* with the one gate function", () => {
    assert.match(defaultBehaviour, /function_arn\s*=\s*aws_cloudfront_function\.gate\.arn/);
    assert.equal(byPath["/admin*"]?.gated, true);
    assert.equal(byPath["/api/admin*"]?.gated, true);
  });

  it("leaves /api/* (public API and Razorpay webhook) without any function", () => {
    const [publicApi] = blocks(WEB_TF, "ordered_cache_behavior").filter((body) =>
      /path_pattern\s*=\s*"\/api\/\*"/.test(body),
    );

    assert.doesNotMatch(publicApi, /function_association/);
  });

  it("sends the admin headers policy (Cache-Control: no-store) on both admin paths", () => {
    assert.equal(byPath["/admin*"]?.headers, "admin");
    assert.equal(byPath["/api/admin*"]?.headers, "admin");
    assert.equal(byPath["/api/*"]?.headers, "site");
    assert.match(defaultBehaviour, /aws_cloudfront_response_headers_policy\.web\["site"\]/);
    const [admin] = blocks(WEB_TF, "admin =");
    assert.match(admin, /"Cache-Control"\s*=\s*"no-store"/);
  });

  it("has no distribution-wide custom_error_response (it would turn API 403/404 into HTML)", () => {
    assert.doesNotMatch(WEB_TF, /^\s*custom_error_response\s*\{/m);
  });
});
