-- Up Migration

ALTER TABLE registrations
  ADD COLUMN declarations_accepted_at timestamptz,
  ADD COLUMN declarations_version text,
  ADD CONSTRAINT registrations_declarations_together
    CHECK ((declarations_accepted_at IS NULL) = (declarations_version IS NULL));

-- Down Migration

ALTER TABLE registrations
  DROP CONSTRAINT registrations_declarations_together,
  DROP COLUMN declarations_version,
  DROP COLUMN declarations_accepted_at;