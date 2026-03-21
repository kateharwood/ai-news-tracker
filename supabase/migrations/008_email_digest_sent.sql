-- Track one email digest per calendar day (idempotency for cron)
CREATE TABLE IF NOT EXISTS public.email_digest_sent (
  date date PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_digest_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_digest_sent_service" ON public.email_digest_sent FOR ALL TO service_role USING (true) WITH CHECK (true);
