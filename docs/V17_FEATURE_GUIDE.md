# PrintPilot V1.7 — Feature Guide

## Super Admin Console
Sign in with the existing Supabase account listed in \`public.platform_admins\`.
The console displays shop totals, active shops, seven-day order volume, verified revenue,
waiting/printing jobs, and orders whose cloud deletion is pending.
Search shops or filter by active/suspended status, and use existing invite/activation controls.

- All platform-wide metrics come from \`printpilot_admin_shop_metrics()\`.
- This RPC is executable only by Supabase's \`service_role\`, and the Edge Function
  \`printpilot-admin\` checks both a valid login session and \`platform_admins\` membership.
- Metrics contain no customer names, file paths, or document bytes.
- The admin table currently displays the newest 200 shops.

## Browser order notifications
Sign in to a shop and click **Enable order alerts** in the sidebar.
The browser asks permission only after the shop owner clicks.
Alerts use owner-scoped Supabase Realtime UPDATE events when a new order finishes uploading.
The existing visible-tab refresh continues to work if Realtime is unavailable.

- Alerts work only while PrintPilot is open, including background tabs where supported.
- This release does **not** send push notifications after the app/browser is fully closed.
- Permission is remembered per shop in that browser. Browsers can block notifications.
- No R2 operations are needed for notifications.

## Installable web app (PWA)
Click **Install PrintPilot app** in the shop sidebar, login screen, or Super Admin Console.
On compatible desktop Chrome/Edge browsers, accept the install prompt.
On iPhone, use Safari → Share → Add to Home Screen.
The app opens at the shop sign-in page and uses the existing secure authentication.

- The service worker caches only the public static app shell and icons.
- Cloud orders, login, documents, and printing still require an internet connection.
- Supabase, Cloudflare R2, and customer uploads are never cached by the service worker.

## Printable shop QR poster
Sign in to a shop and click **Shop QR & poster**.
The preview is generated locally using the vendored MIT-licensed QR library.
Click **Download poster (PNG)** for a high-resolution A4-format image that includes the
current shop name, scan-to-print instructions, and the permanent customer link.
Print it at the counter or share the PNG. No R2 storage or external QR service is used.

## Testing and cost
- Run \`node --test tests/smoke.test.mjs\` for automated syntax, security and integration checks.
- Admin and notification data are stored/served by Supabase. PWA and QR poster use the browser.
- These four features add **no Cloudflare R2 object requests**.
- Physical printer output, live notifications in every browser, and installation on
  each mobile platform still require manual end-to-end device testing.
