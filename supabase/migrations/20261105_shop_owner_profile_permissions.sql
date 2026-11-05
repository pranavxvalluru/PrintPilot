-- PrintPilot shop owner settings permissions
-- The existing public.shops RLS policies restrict edits to auth.uid() = owner_id.
-- Grant only the profile/pricing fields needed by the owner settings screen.
-- Do not grant edits to owner_id, slug, or is_active.
grant update (name, bw_price, color_price)
on table public.shops
to authenticated;
