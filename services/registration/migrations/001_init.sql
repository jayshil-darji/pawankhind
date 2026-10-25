-- Up Migration

CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  event_date    date        NOT NULL,
  capacity      integer     NOT NULL CHECK (capacity > 0),
  first_bib     integer     NOT NULL CHECK (first_bib > 0),
  next_bib      integer     NOT NULL,
  slots_taken   integer     NOT NULL DEFAULT 0,
  fee_paise     integer     NOT NULL CHECK (fee_paise >= 0),
  reg_opens_at  timestamptz NOT NULL,
  reg_closes_at timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (reg_closes_at > reg_opens_at),
  CHECK (slots_taken >= 0 AND slots_taken <= capacity),
  CHECK (next_bib >= first_bib AND next_bib <= first_bib + capacity),
  CHECK (next_bib - first_bib <= slots_taken)
);

CREATE TABLE registrations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                 uuid        NOT NULL REFERENCES events (id),
  status                   text        NOT NULL CHECK (status IN ('held', 'confirmed', 'expired')),
  channel                  text        NOT NULL CHECK (channel IN ('online', 'admin_cash', 'admin_upi', 'paper_form')),
  entered_by               text,
  full_name                text        NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100),
  date_of_birth            date        NOT NULL,
  gender                   text        NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  mobile                   text        NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  tshirt_size              text        NOT NULL CHECK (tshirt_size IN ('XS', 'S', 'M', 'L', 'XL', 'XXL')),
  city                     text        NOT NULL CHECK (char_length(btrim(city)) > 0),
  emergency_contact_name   text        NOT NULL CHECK (char_length(btrim(emergency_contact_name)) > 0),
  emergency_contact_mobile text        NOT NULL CHECK (emergency_contact_mobile ~ '^[6-9][0-9]{9}$'),
  hold_expires_at          timestamptz,
  bib_number               integer,
  confirmed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'held' OR hold_expires_at IS NOT NULL),
  CHECK ((status = 'confirmed') = (bib_number IS NOT NULL)),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  CHECK (channel = 'online' OR entered_by IS NOT NULL),
  UNIQUE (event_id, bib_number)
);

-- The same person cannot hold or confirm two slots at once.
CREATE UNIQUE INDEX registrations_one_active_per_person
  ON registrations (event_id, mobile, lower(btrim(full_name)), date_of_birth)
  WHERE status IN ('held', 'confirmed');

CREATE INDEX registrations_mobile_idx ON registrations (mobile);
CREATE INDEX registrations_hold_expiry_idx ON registrations (hold_expires_at) WHERE status = 'held';

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     uuid        NOT NULL REFERENCES registrations (id),
  method              text        NOT NULL CHECK (method IN ('razorpay', 'cash', 'upi_manual')),
  status              text        NOT NULL CHECK (status IN ('created', 'captured', 'failed')),
  amount_paise        integer     NOT NULL CHECK (amount_paise > 0),
  provider_order_id   text UNIQUE,
  provider_payment_id text UNIQUE,
  reference           text,
  collected_by        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  captured_at         timestamptz,
  CHECK (method <> 'razorpay' OR provider_order_id IS NOT NULL),
  CHECK ((status = 'captured') = (captured_at IS NOT NULL))
);

CREATE INDEX payments_registration_idx ON payments (registration_id);

-- Down Migration

DROP TABLE payments;
DROP TABLE registrations;
DROP TABLE events;