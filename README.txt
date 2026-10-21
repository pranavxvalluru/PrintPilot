PrintPilot V1.5.10 — Preview & Complete Order
============================================
Deploy: upload index.html from this ZIP as the root index.html in your GitHub Pages PrintPilot repo.

Changes:
- Removed Start Printing action from the shop order card.
- Kept Preview / Open Document and added Complete Order below.
- Preview opens the file using a temporary private URL without changing order status.
- Complete Order checks payment verification, prompts the shopkeeper to verify physical completion,
  then calls the existing Supabase Edge Function to mark the order printed and delete its cloud document.
- Legacy Printing orders can also be completed directly.
- Payment confirmation and cancellation remain available.
- No Supabase deployment or DB schema change required.

Privacy: In web-only mode actual printer spool success cannot be detected. Shop staff must confirm
physical printing before using Complete Order. After cloud deletion the document cannot be previewed.
