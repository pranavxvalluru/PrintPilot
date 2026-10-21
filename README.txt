PrintPilot V1.5.11 — PRINT / REPRINT / AUTO-DELETE
================================================
1. This ZIP includes index.html for GitHub Pages.
2. IMPORTANT: Deploy the Supabase migration, Edge Function, and scheduler before publishing this frontend.
   Without backend setup, Print Document will not start and no automatic deletion can occur.
3. When shop owner clicks Print Document, a five-minute server-owned window begins.
4. Preview Again / Reprint is available until the window expires.
5. Supabase pg_cron runs each minute, deletes files, verifies absence, then marks order Printed.
6. Cron/network/storage errors delay completion and are retried; precise deletion is not guaranteed at second 300.
7. The website CANNOT confirm actual paper output or the native PDF print dialog.
8. Only the PrintPilot project is targeted; do not apply SQL to other apps.
