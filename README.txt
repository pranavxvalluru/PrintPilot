PrintPilot V1.5.8 - Stability update
=====================================

Deploy to GitHub Pages:
1. Download/extract this ZIP.
2. Upload its index.html to the root of your PrintPilot repository, replacing the previous index.html.
3. Wait for GitHub Pages deployment, then refresh your website.

Changes:
- Cash / manual payment verification now requires an explicit receipt confirmation.
- Opening a PDF does NOT call the backend Start Printing action.
- Start printing requires a separate shopkeeper confirmation.
- Confirm physically printed is disabled until payment is verified and printing has started.
- Existing server-mediated print completion and cancellation cleanup are retained.
- New 3-step workflow visible in order details.
- Branding and introduction from V1.5.7 retained.

Limitations:
- This build does not automate a printer or verify actual hardware output.
- Existing orders incorrectly marked Printing by earlier versions are not reset automatically.
- Current cloud uploads still use one file per order, <=5 MB, and cash at counter.
- The change is frontend-only; no live Supabase project or order data is modified during creation.
- Verify the flows on a test shop and non-sensitive test document before production rollout.
