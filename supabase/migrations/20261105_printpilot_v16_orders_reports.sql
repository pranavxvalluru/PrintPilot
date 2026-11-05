-- PrintPilot V1.6: one-hour abandoned-document retention, private order tracking,
-- and owner-scoped daily sales without querying R2.
alter table public.orders add column if not exists tracking_token_sha256 text;
alter table public.documents alter column delete_after set default (now() + interval '1 hour');
create index if not exists printpilot_orders_cleanup_v16
 on public.orders (created_at)
 where cloud_deleted_at is null and print_window_started_at is null;

create or replace function public.printpilot_daily_sales(p_days integer default 7)
returns table(sale_date date, order_count bigint, revenue_amount numeric, archived_count bigint)
language sql stable security invoker set search_path = ''
as $$
 with days as (
  select ((now() at time zone 'Asia/Kolkata')::date - g.n)::date as day
  from generate_series(0, least(greatest(coalesce(p_days,7),1),31)-1) as g(n)
 ),
 live as (
  select (coalesce(o.payment_verified_at,o.printed_at,o.created_at) at time zone 'Asia/Kolkata')::date as day,
         count(*)::bigint as orders,
         coalesce(sum(o.total_amount),0)::numeric as revenue
  from public.orders o
  join public.shops s on s.id=o.shop_id and s.owner_id=(select auth.uid())
  where o.payment_status='verified'
    and o.status in ('printed','collected')
    and coalesce(o.payment_verified_at,o.printed_at,o.created_at) >=
      ((now() at time zone 'Asia/Kolkata')::date - 31)::timestamp at time zone 'Asia/Kolkata'
  group by 1
 ),
 archived as (
  select r.sale_date as day,
         coalesce(sum(r.completed_paid_orders),0)::bigint as orders,
         coalesce(sum(r.revenue_amount),0)::numeric as revenue,
         coalesce(sum(r.archived_order_count),0)::bigint as archived_orders
  from public.printpilot_shop_revenue_daily r
  join public.shops s on s.id=r.shop_id and s.owner_id=(select auth.uid())
  where r.sale_date >= (now() at time zone 'Asia/Kolkata')::date - 31
  group by 1
 )
 select d.day,
        (coalesce(l.orders,0)+coalesce(a.orders,0))::bigint,
        (coalesce(l.revenue,0)+coalesce(a.revenue,0))::numeric,
        coalesce(a.archived_orders,0)::bigint
 from days d
 left join live l on l.day=d.day
 left join archived a on a.day=d.day
 order by d.day desc
$$;
revoke all on function public.printpilot_daily_sales(integer) from public, anon;
grant execute on function public.printpilot_daily_sales(integer) to authenticated;
