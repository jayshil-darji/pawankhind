-- Up Migration

-- One row describing this environment. live_activated_at is set by the first app start in
-- live mode and can never be cleared or changed afterwards: the pre-launch reset script
-- refuses to run once it is set.
CREATE TABLE environment_state (
  singleton         boolean PRIMARY KEY DEFAULT true CONSTRAINT environment_state_one_row CHECK (singleton),
  live_activated_at timestamptz
);

INSERT INTO environment_state DEFAULT VALUES;

CREATE FUNCTION environment_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'environment_state cannot be deleted';
  END IF;
  IF OLD.live_activated_at IS NOT NULL
     AND NEW.live_activated_at IS DISTINCT FROM OLD.live_activated_at THEN
    RAISE EXCEPTION 'live_activated_at cannot change once set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER environment_state_guard
  BEFORE UPDATE OR DELETE ON environment_state
  FOR EACH ROW EXECUTE FUNCTION environment_state_guard();

-- Down Migration

DROP TABLE environment_state;
DROP FUNCTION environment_state_guard();
