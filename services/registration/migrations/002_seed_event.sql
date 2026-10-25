-- Up Migration

INSERT INTO events (name, event_date, capacity, first_bib, next_bib, fee_paise, reg_opens_at, reg_closes_at)
VALUES ('Pawankhind Season-3', '2027-01-17', 3000, 1001, 1001, 20000,
        '2026-11-15 00:00:00+05:30', '2027-01-08 23:59:59+05:30');

-- Down Migration

DELETE FROM events WHERE name = 'Pawankhind Season-3';