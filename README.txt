PrintPilot V1.5.9 — Printing Status Workflow

CHANGELOG
- Removes the shop dashboard's "Confirm printed" action.
- A single click on "Start Printing" updates the order to Printing, then displays "Printing".
- Previewing/opening the PDF leaves the order unchanged.
- Cash payment confirmation remains required before document access.
- Preserves Supabase Auth, private storage, order history, cancelled-order cleanup, and brand intro.

IMPORTANT LIMITATION
- "Start Printing" is NOT confirmation of physical print completion.
- Supabase Storage files are NOT deleted by this action. Existing backend file removal only runs on completion/cancellation.
- This version removes the ordinary UI completion action; a reliable completion/retention workflow is needed before production rollout, otherwise printing files can accumulate.

DEPLOY
Upload index.html to the existing GitHub Pages repository. No database or Edge Function deployment required.
