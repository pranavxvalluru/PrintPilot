# Provisioning a PrintPilot shop

PrintPilot owner accounts use Supabase Auth. The owner dashboard reads
`public.shops` using the authenticated user's `auth.uid()`; no email,
password, or shop ID is hardcoded into the frontend.

## Provision an existing Supabase Auth user

1. Create the user in Supabase Auth (or confirm they already exist).
2. Confirm their email and set up their password securely.
3. Create a row in `public.shops` with that user's Auth UUID as `owner_id`.
   Use a unique `slug` and the desired `name`, `bw_price`, and
   `color_price`. Do this using the privileged backend or Supabase SQL
   editor, **not** a public browser credential.
4. The owner signs in to the normal PrintPilot URL and their dashboard
   loads the assigned shop automatically.
5. The customer URL format is:
   `https://pranavxvalluru.github.io/PrintPilot/?view=customer&shop=<slug>`

## Database permissions

Migration `20261105_shop_owner_profile_permissions.sql` grants authenticated
users update access only to shop display name and printing prices. Existing
row-level security policies enforce owner-only access. Do not grant update
privileges on `owner_id`, `slug`, or `is_active` to regular shop owners.

Avoid storing shop passwords, API keys, or customer documents in this repo.
