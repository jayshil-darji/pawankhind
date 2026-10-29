// CloudFront viewer-request function (runtime cloudfront-js-2.0) for the site, /admin* and
// /api/admin*. One function on every gated behaviour, so the realm and credentials are the same
// everywhere and a browser's cached Basic credentials cover the admin API without a second prompt.
//
// Terraform (infra/envs/dev/web.tf) replaces the two placeholders below; gate.test.mjs does the
// same with a fake password. No other values are templated in.
var EXPECTED_AUTHORIZATION = "Basic __GATE_TOKEN__";
var REALM = "__GATE_REALM__";

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var isApi = uri === "/api" || uri.indexOf("/api/") === 0;
  var isAdminApi = uri.indexOf("/api/admin") === 0;

  // The public API (registrations, Razorpay webhook) is never gated, even if this function is
  // ever attached to its behaviour by mistake.
  if (isApi && !isAdminApi) {
    return request;
  }

  if (!hasGateCredentials(request)) {
    return challenge();
  }

  if (isAdminApi) {
    // Until origin TLS (P8) the leg to the instance is plain HTTP, so the gate password must not
    // travel on it. The admin API authenticates with its own session cookie.
    delete request.headers.authorization;
    return request;
  }

  // Single-page-app fallback: paths without a file extension get index.html.
  var last = uri.split("/").pop();
  if (last.indexOf(".") === -1) {
    request.uri = "/index.html";
  }
  return request;
}

function hasGateCredentials(request) {
  var header = request.headers.authorization;
  // A plain string comparison: a malformed header can never throw, it just does not match.
  return !!header && header.value === EXPECTED_AUTHORIZATION;
}

function challenge() {
  return {
    statusCode: 401,
    statusDescription: "Unauthorized",
    headers: {
      "www-authenticate": { value: 'Basic realm="' + REALM + '"' },
      "cache-control": { value: "no-store" },
      "x-robots-tag": { value: "noindex, nofollow" },
    },
  };
}
