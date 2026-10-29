import { isAmbiguousPath } from "../src/http-options.js";

describe("isAmbiguousPath", () => {
  it.each([
    "/api/%61dmin/ping",
    "/api/%2e/admin/ping",
    "/api//admin/ping",
    "/api/./admin/ping",
    "/api/x/../admin/ping",
    "/api/admin/.",
    "/api/admin/..",
    "/api/admin%2Fping",
    "/api\\admin/ping",
    "//api/admin",
  ])("flags %s", (url) => {
    expect(isAmbiguousPath(url)).toBe(true);
  });

  it.each([
    "/",
    "/api/admin/ping",
    "/api/registrations/3f2b8c1e-0d4a-4c3e-9b7a-2f1e0d9c8b7a/status",
    "/api/webhooks/razorpay",
    "/api/registrations?note=a%20b",
    "/api/x?next=/a//b/../c\\d",
    "/assets/index-abc.js",
    "/api/v1.2/thing",
  ])("allows %s", (url) => {
    expect(isAmbiguousPath(url)).toBe(false);
  });
});
