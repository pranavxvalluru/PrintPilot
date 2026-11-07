-- PrintPilot V1.7: service-only aggregate metrics and owner-authorized live notifications.
-- No customer files, R2 reads, or sensitive order contents are returned to the admin UI.
create or replace function public.printpilot_admin_shop_metrics()
returns table (
  shop_id uuid,
  orders_7d bigint,
  waiting_orders bigint,
  printing_orders bigint,
  cleanup_pending bigint,
  verified_revenue_7d numeric,
  last_order_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
 with live as (
  select o.shop_id,
   count(*) filter (where o.created_at >= now() - interval '7 days')::bigint as orders_7d,
   count(*) filter (where o.cloud_deleted_at is null and o.status in ('received','verified') and o.upload_state='ready')::bigint as waiting_orders,
   count(*) filter (where o.cloud_deleted_at is null and o.status='printing')::bigint as printing_orders,
   count(*) filter (where o.cloud_deleted_at is null and
     ((o.print_window_started_at is null and o.created_at < now()-interval '1 hour')
      or (o.print_window_expires_at is not null and o.print_window_expires_at < now())))::bigint as cleanup_pending,
   coalesce(sum(o.total_amount) filter (where o.payment_status='verified' and o.status in ('printed','collected')
      and coalesce(o.payment_verified_at,o.printed_at,o.created_at) >= now()-interval '7 days'),0)::numeric as verified_revenue_7d,
   max(o.created_at) as last_order_at
  from public.orders o group by o.shop_id
 ),
 archived as (
  select r.shop_id,
    coalesce(sum(r.revenue_amount),0)::numeric as verified_revenue_7d
  from public.printpilot_shop_revenue_daily r
  where r.sale_date >= ((now() at time zone 'Asia/Kolkata')::date - 6)
  group by r.shop_id
 )
 select s.id,
  coalesce(l.orders_7d,0)::bigint,
  coalesce(l.waiting_orders,0)::bigint,
  coalesce(l.printing_orders,0)::bigint,
  coalesce(l.cleanup_pending,0)::bigint,
  (coalesce(l.verified_revenue_7d,0)+coalesce(a.verified_revenue_7d,0))::numeric,
  l.last_order_at
 from public.shops s
 left join live l on l.shop_id=s.id
 left join archived a on a.shop_id=s.id
 order by s.created_at desc
$$;
revoke all on function public.printpilot_admin_shop_metrics() from public, anon, authenticated;
grant execute on function public.printpilot_admin_shop_metrics() to service_role;

-- Realtime events are filtered by the existing owner-scoped orders SELECT RLS.
-- The app subscribes to ready-state UPDATEs only, never customer files.
do $$
begin
 if not exists (
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='orders'
 ) then
   alter publication supabase_realtime add table public.orders;
 end if;
end $$;
