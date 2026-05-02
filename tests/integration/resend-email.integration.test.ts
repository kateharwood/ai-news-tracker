import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { resendErrorHandler, resendSuccessHandler } from "../helpers/msw-resend";

describe("sendDigestEmail (mocked Resend HTTP)", () => {
  const server = setupServer();

  beforeAll(() =>
    server.listen({
      onUnhandledRequest: "error",
    })
  );
  afterEach(() => {
    vi.unstubAllEnvs();
    server.resetHandlers();
  });
  afterAll(() => server.close());

  test("posts JSON and resolves on 2xx", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_mock_key");
    server.use(resendSuccessHandler);

    const { sendDigestEmail } = await import("@/lib/email-digest");

    await expect(
      sendDigestEmail({
        to: "reader@example.com",
        from: "digest@example.com",
        subject: "Test",
        html: "<p>Hi</p>",
      })
    ).resolves.toBeUndefined();
  });

  test("throws with Resend error body", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_mock_key");
    server.use(resendErrorHandler(422, '{"message":"bad request"}'));

    const { sendDigestEmail } = await import("@/lib/email-digest");

    await expect(
      sendDigestEmail({
        to: "reader@example.com",
        from: "digest@example.com",
        subject: "Test",
        html: "<p>Hi</p>",
      })
    ).rejects.toThrow(/422/);
  });
});
