-- Up Migration

-- Which Razorpay mode created each payment. Every payment so far was made with test keys
-- (live keys were never accepted), so existing rows are filled with 'test'. The default is
-- then dropped: a new payment must state its mode, so a forgotten value fails instead of
-- quietly recording 'test' (the pre-launch reset relies on "no live payments").
ALTER TABLE payments
  ADD COLUMN provider_mode text NOT NULL DEFAULT 'test'
    CONSTRAINT payments_provider_mode_valid CHECK (provider_mode IN ('test', 'live'));

ALTER TABLE payments ALTER COLUMN provider_mode DROP DEFAULT;

-- Down Migration

ALTER TABLE payments DROP COLUMN provider_mode;
