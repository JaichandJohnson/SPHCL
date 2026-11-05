# MDS LIMS: Local/cloud synchronization, stock integration and Android viewer

Status: design contract only; NOT deployed or enabled.

## Applications and authority
- Local MDS LIMS (Windows LAN): laboratory record entry, editing and reports while offline.
- Cloud MDS LIMS (Render + Atlas): remote access and synchronized laboratory records.
- Local laboratory stock-management application: authoritative writer for inventory quantities, receipts, adjustments and consumption ledger.
- MDS LIMS Mobile Viewer (Android): authenticated, **read-only** laboratory and stock views. No write-capable credentials or endpoints are exposed to the mobile app.

## Synchronization boundaries
- Synchronize approved laboratory business data through authenticated FastAPI endpoints, never direct public MongoDB access.
- Do not synchronize sessions, passwords, OAuth tokens, backup credentials or local machine settings.
- Track each committed mutation in a durable outbox in the same database transaction as the record change. If MongoDB transactions are unavailable, do not enable synchronization until a reliable atomic alternative is designed and tested.
- Apply incoming events idempotently using unique event IDs and document revisions; retain tombstones for deletions and log unresolved conflicts without overwriting.
- Establish a collision-free policy for offline patient IDs, dataset/year lab-number sequences, and all legacy numbering variants **before** enabling bidirectional writes. Do not rely on independent local/cloud counters.
- Master data and record result corrections must participate in the same change-tracking policy.
- Use HTTPS, service authentication, least privilege, retries with backoff, pagination and bounded batches.
- Keep production sync disabled until test-database validation, backup/restore drills, conflict testing and explicit approval.

## Stock integration
- Stock ledger is append-only and each transaction has an immutable transaction ID.
- Completed test consumption is keyed by stable source identifiers: record ID, sample ID, test ID, completion/version event and reagent mapping ID. Unique indexes and transactional checks prevent duplicate deductions on retries or replays.
- A corrected, cancelled or reopened test must generate an explicit reversal/adjustment rather than deleting historical consumption.
- Partial units, units of measure, reagent mapping versions, lot/batch and expiry information must be preserved where applicable.
- The stock service remains the only inventory writer. The LIMS sync worker may deliver test-completion events but must not update quantity fields directly.
- Manual stock entries and daily consumption reports remain restricted to authorized stock-management users.

## Android viewer
- The Android app can view authorized laboratory records, test results, reports, stock balances, low-stock alerts, batches/expiry dates and stock-consumption history.
- Read-only stock API endpoints should be implemented behind authenticated FastAPI access, with field-level authorization and pagination.
- Never bundle stock database credentials or privileged API secrets in the mobile app.
- When offline, show the last synchronized snapshot with a clear "last updated" timestamp; do not imply it is live stock.
- A cloud-based viewer can only display stock data after a separate, controlled stock read-model sync is implemented; this does not make the cloud a stock writer.
- Avoid including patient-identifying information in stock event payloads unless strictly necessary.

## Release gates
1. Review existing stock application schema and Android viewer implementation before coding integration adapters.
2. Build and test outbox/inbox, idempotency and conflict detection in isolated test databases.
3. Validate numbering collisions, network interruption, concurrent edits, partial sync failures and stock replays.
4. Verify viewer cannot invoke any mutation endpoint, even with a modified client.
5. Verify backup recovery and rollback; approve a staged rollout before production changes.
