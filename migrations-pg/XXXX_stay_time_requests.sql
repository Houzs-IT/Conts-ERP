-- REVERSAL:
-- DROP TABLE stay_time_requests

-- style of late check out requests & unit bed sizes
/*
id
connect_request_id UNIQUE
reservation_id
kind: check_in | check_out
requested_time
guest_message
approved_in_connect_by
status: pending | applied | rejected
decided_by
decided_at
created_at
*/

set local search_path = pos;

CREATE TABLE IF NOT EXISTS stay_time_requests (
    id TEXT PRIMARY KEY,
    connect_request_id TEXT NOT NULL UNIQUE,
    reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE, 
    requested_time TEXT NOT NULL CHECK (requested_time ~ '^([01]\d|2[0-3]):[0-5]\d$'),
    guest_message TEXT,
    late_checkout_request_id TEXT REFERENCES late_checkout_requests(id) ON DELETE CASCADE,
    approved_in_connect_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
    decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    decided_at TEXT,
    created_at TEXT NOT NULL);

ALTER TABLE stay_time_requests OWNER TO pos_app;
ALTER TABLE stay_time_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON stay_time_requests TO pos_app;

select demo.sync();
