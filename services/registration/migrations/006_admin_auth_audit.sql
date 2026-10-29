-- Up Migration

-- Admin accounts, enrolment links and the append-only audit log (admin plan A3), plus the
-- database rules for paper + cash entry.
--
-- Existing rows are checked, not rewritten: so far the app has only written online
-- registrations and razorpay payments, with no operator. Anything else stops the migration.
DO $$
DECLARE
  old_channels  bigint;
  old_methods   bigint;
  with_operator bigint;
BEGIN
  SELECT count(*) INTO old_channels FROM registrations WHERE channel NOT IN ('online', 'paper_form');
  SELECT count(*) INTO old_methods FROM payments WHERE method NOT IN ('razorpay', 'cash');
  SELECT (SELECT count(*) FROM registrations WHERE entered_by IS NOT NULL)
       + (SELECT count(*) FROM payments WHERE collected_by IS NOT NULL)
    INTO with_operator;
  IF old_channels + old_methods + with_operator > 0 THEN
    RAISE EXCEPTION 'migration 006 refused: % registrations with a retired channel, % payments with a retired method, % rows with an operator set',
      old_channels, old_methods, with_operator;
  END IF;
END;
$$;

CREATE TABLE admin_users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username            text        NOT NULL CHECK (char_length(btrim(username)) > 0),
  display_name        text        NOT NULL CHECK (char_length(btrim(display_name)) > 0),
  role                text        NOT NULL CHECK (role IN ('admin', 'kit')),
  password_hash       text,
  totp_secret_enc     bytea,
  totp_last_step      bigint,
  mfa_enrolled_at     timestamptz,
  failed_logins       integer     NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until        timestamptz,
  disabled_at         timestamptz,
  password_changed_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- No password-only accounts: enrolment sets the password and TOTP together.
  CONSTRAINT admin_password_with_mfa CHECK ((password_hash IS NULL) = (mfa_enrolled_at IS NULL)),
  CONSTRAINT admin_mfa_has_secret    CHECK (mfa_enrolled_at IS NULL OR totp_secret_enc IS NOT NULL)
);

CREATE UNIQUE INDEX admin_users_username_key ON admin_users (lower(username));

CREATE TABLE admin_enrolments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid        NOT NULL REFERENCES admin_users (id),
  token_hash    bytea       NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  -- sha256 of the link token; the token itself is never stored.
  CONSTRAINT enrolment_token_is_sha256 CHECK (octet_length(token_hash) = 32)
);

CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid REFERENCES admin_users (id),
  actor_kind  text        NOT NULL CHECK (actor_kind IN ('user', 'cli', 'anonymous')),
  action      text        NOT NULL CHECK (char_length(btrim(action)) > 0),
  target_type text,
  target_id   text,
  details     jsonb       NOT NULL DEFAULT '{}',
  ip          inet,
  CONSTRAINT audit_actor_matches_kind CHECK ((actor_kind = 'user') = (actor_id IS NOT NULL))
);

COMMENT ON TABLE audit_log IS
  'Append-only record of admin actions: UPDATE, DELETE and TRUNCATE raise. details holds codes, filters and row counts; old and new values only for corrections. Failed logins are actor_kind ''anonymous'' with no actor_id. The typed username is never stored: when it matches an existing account, only that account''s id goes into details (account_id).';

CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Row triggers do not fire on TRUNCATE. Only test cleanup (resetDatabase) disables this one.
-- The app connects as the table owner, so this stops mistakes, not a compromised app.
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- Records are never deleted: registrations expire, admin users are disabled.
CREATE FUNCTION refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER registrations_no_delete
  BEFORE DELETE ON registrations FOR EACH ROW EXECUTE FUNCTION refuse_delete();
CREATE TRIGGER payments_no_delete
  BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION refuse_delete();
CREATE TRIGGER admin_users_no_delete
  BEFORE DELETE ON admin_users FOR EACH ROW EXECUTE FUNCTION refuse_delete();

-- UPI is paid only through Razorpay; admins take paper forms with cash.
ALTER TABLE registrations
  DROP CONSTRAINT registrations_channel_check,
  ADD CONSTRAINT registrations_channel_valid CHECK (channel IN ('online', 'paper_form')),
  ALTER COLUMN entered_by TYPE uuid USING entered_by::uuid,
  ADD CONSTRAINT registrations_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES admin_users (id);

ALTER TABLE payments
  DROP CONSTRAINT payments_method_check,
  ADD CONSTRAINT payments_method_valid CHECK (method IN ('razorpay', 'cash')),
  ALTER COLUMN collected_by TYPE uuid USING collected_by::uuid,
  ADD CONSTRAINT payments_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES admin_users (id),
  ADD CONSTRAINT payments_cash_complete CHECK (
    method <> 'cash'
    OR (reference IS NOT NULL AND btrim(reference) <> '' AND collected_by IS NOT NULL AND status = 'captured')
  );

-- Receipt books are numbered per season and this database holds one event, so a receipt
-- number is unique across all cash payments.
CREATE UNIQUE INDEX payments_cash_receipt_key ON payments (lower(btrim(reference))) WHERE method = 'cash';
CREATE UNIQUE INDEX payments_one_cash_per_registration ON payments (registration_id) WHERE method = 'cash';

COMMENT ON COLUMN payments.provider_mode IS
  'Test or real money, with no default: every insert states it. Razorpay rows: the key mode that created the order. Cash rows: the environment''s RAZORPAY_MODE, so real cash counts as live for the "no live payments" reset guard.';

-- A confirmed registration keeps its BIB, identity, confirmation and declarations. Name and
-- mobile corrections (and the T-shirt size) stay possible. The confirm path only updates
-- held or expired rows.
CREATE FUNCTION registrations_confirmed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'confirmed' AND (
       NEW.bib_number IS DISTINCT FROM OLD.bib_number
    OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
    OR NEW.declarations_accepted_at IS DISTINCT FROM OLD.declarations_accepted_at
    OR NEW.declarations_version IS DISTINCT FROM OLD.declarations_version
  ) THEN
    RAISE EXCEPTION 'confirmed registration %: BIB, date of birth, event, channel, status, confirmation time and declarations cannot change', OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER registrations_confirmed_guard
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION registrations_confirmed_guard();

-- Down Migration

-- Drops the admin tables, audit history included. Only for rolling back before real use.
DROP TRIGGER registrations_confirmed_guard ON registrations;
DROP FUNCTION registrations_confirmed_guard();

COMMENT ON COLUMN payments.provider_mode IS NULL;
DROP INDEX payments_one_cash_per_registration;
DROP INDEX payments_cash_receipt_key;

ALTER TABLE payments
  DROP CONSTRAINT payments_cash_complete,
  DROP CONSTRAINT payments_collected_by_fkey,
  ALTER COLUMN collected_by TYPE text USING collected_by::text,
  DROP CONSTRAINT payments_method_valid,
  ADD CONSTRAINT payments_method_check CHECK (method IN ('razorpay', 'cash', 'upi_manual'));

ALTER TABLE registrations
  DROP CONSTRAINT registrations_entered_by_fkey,
  ALTER COLUMN entered_by TYPE text USING entered_by::text,
  DROP CONSTRAINT registrations_channel_valid,
  ADD CONSTRAINT registrations_channel_check CHECK (channel IN ('online', 'admin_cash', 'admin_upi', 'paper_form'));

DROP TRIGGER payments_no_delete ON payments;
DROP TRIGGER registrations_no_delete ON registrations;

DROP TABLE audit_log;
DROP TABLE admin_enrolments;
DROP TABLE admin_users;
DROP FUNCTION refuse_delete();
DROP FUNCTION audit_log_append_only();
