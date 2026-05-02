import { http, HttpResponse } from "msw";

const RESEND_EMAILS = "https://api.resend.com/emails";

export const resendSuccessHandler = http.post(RESEND_EMAILS, async () =>
  HttpResponse.json({ id: "re_mock_1" })
);

export function resendErrorHandler(status: number, bodyText: string) {
  return http.post(RESEND_EMAILS, () => new HttpResponse(bodyText, { status }));
}
