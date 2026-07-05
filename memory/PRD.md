# PRD — SPHCL Molecular Diagnosis Lab Data Management App

## Original Problem Statement
An app to enter and generate reports for the Molecular Diagnosis Section, State Public Health & Clinical Laboratory, Trivandrum. Fields: Lab number, date, name, age, district, test, sample type, result(s), result date. Multiple results per record. Reports: line list, filter by test / district / result / date range, export CSV/Excel. Google Drive + local save. Multi-user concurrent. CSV bulk import. Bulk result entry for many samples with same result.

## Personas
- **Lab Technician**: enters records, applies bulk results, exports data.
- **Public Health Officer**: filters and exports reports; uploads CSVs from labs.
- **Admin**: manages dropdowns for tests / districts / sample types.

## Core Requirements
- Google sign-in (Emergent Auth), multi-user cookie sessions.
- Records CRUD with dynamic multi-result fields.
- Predefined + editable dropdowns for Test / District / Sample Type (Kerala districts seeded).
- Filtered reports with CSV/Excel export.
- Google Drive backup (client-side GIS OAuth, drive.file scope).
- CSV/Excel bulk import.
- Bulk result apply (per test → checkbox multi-select → same result).
- Multi-user concurrent editing (MongoDB shared backend).

## Implemented (Feb 2026)
- Emergent Google Auth + session cookie flow.
- FastAPI backend: /api/auth/*, /api/records CRUD + filter/paging, /api/records/import, /api/records/export (csv/xlsx), /api/records/bulk-result, /api/options, /api/stats.
- MongoDB collections: users, user_sessions, records, options.
- React 19 UI: Login, Dashboard, DataEntry, Records line-list, Reports + export, Bulk Import, Bulk Result, Settings.
- Google Drive upload via GIS (env: REACT_APP_GOOGLE_CLIENT_ID).

## Backlog
- P1: Charts on dashboard (per-district, per-test trends).
- P1: PDF report export.
- P2: Audit trail (who edited what, when).
- P2: Import preview + column mapping UI before commit.
- P2: Role-based access (admin vs technician).
- P2: Email/summary digest.
