-- IndexNow: tells Bing (also feeds ChatGPT search and Copilot), Yandex, Naver and Seznam about new or
-- changed pages on aqtimes.news. pg_cron job 'aq-times-indexnow' runs at :07 and :37 every hour and only
-- pings when something changed. Key file: /baa5df417bf5bdc24ab6c64ae80a6e99.txt
-- Manual full ping: select public.indexnow_ping(true);
-- (Function body as applied in Supabase migration indexnow_content_type_fix.)
create or replace function public.indexnow_ping(force boolean default false)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare last_ping timestamptz; urls jsonb; news_changed boolean; req bigint;
begin
  select coalesce((select value from settings where key = 'indexnow_last'), '1970-01-01T00:00:00Z')::timestamptz into last_ping;
  select force or exists (select 1 from stories where status = 'published' and coalesce(published_at, created_at) > last_ping) into news_changed;
  select coalesce(jsonb_agg(u), '[]'::jsonb) into urls from (
    select 'https://aqtimes.news/updates/' || left(trim(both '-' from regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g')), 70) || '-' || id as u
      from announcements where live and show_to = 'Everyone' and (force or greatest(created_at, coalesce(updated_at, created_at)) > last_ping)
    union all
    select x from unnest(array['https://aqtimes.news/', 'https://aqtimes.news/news', 'https://aqtimes.news/news/badminton',
      'https://aqtimes.news/news/pickleball', 'https://aqtimes.news/news/tennis', 'https://aqtimes.news/updates']) as x where news_changed or force
  ) t;
  if jsonb_array_length(urls) = 0 then return null; end if;
  select net.http_post(url := 'https://api.indexnow.org/indexnow', headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('host', 'aqtimes.news', 'key', 'baa5df417bf5bdc24ab6c64ae80a6e99',
      'keyLocation', 'https://aqtimes.news/baa5df417bf5bdc24ab6c64ae80a6e99.txt', 'urlList', urls),
    timeout_milliseconds := 20000) into req;
  insert into settings(key, value) values ('indexnow_last', now()::text) on conflict (key) do update set value = excluded.value;
  return req;
end; $$;
revoke all on function public.indexnow_ping(boolean) from public, anon, authenticated;
select cron.schedule('aq-times-indexnow', '7,37 * * * *', $$select public.indexnow_ping(false)$$);
