-- NEXTBOT HYPER: authenticated Grok request budgets. Run once in SQL Editor.
begin;
create table if not exists nextbot_private.ai_requests (
 request_id uuid primary key,
 auth_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 status text not null default 'reserved' check (status in ('reserved','completed','failed')),
 input_tokens integer not null default 0,
 output_tokens integer not null default 0
);
create index if not exists ai_requests_actor_time on nextbot_private.ai_requests(auth_id,created_at);
create index if not exists ai_requests_time on nextbot_private.ai_requests(created_at);
alter table nextbot_private.ai_requests enable row level security;
revoke all on nextbot_private.ai_requests from public,anon,authenticated;

create or replace function public.nb_ai_reserve(p_auth_id uuid,p_request_id uuid,p_daily_limit integer default 20,p_project_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare a jsonb; used_count integer; project_count integer; day_start timestamptz;
begin
 if p_auth_id is null or p_request_id is null or p_daily_limit is null or p_daily_limit not between 1 and 200
 or p_project_limit is null or p_project_limit not between 1 and 2000 then raise exception 'invalid request'; end if;
 select r.data into a from nextbot_private.identities i join public.nb_records r on r.path='users/'||i.legacy_uid
 join auth.users u on u.id=i.auth_id where i.auth_id=p_auth_id and u.email_confirmed_at is not null;
 if a is null or coalesce((a->>'disabled')::boolean,false) then raise exception 'AI_ACCOUNT_DISABLED' using errcode='42501'; end if;
 if coalesce((a->>'timeoutUntil')::numeric,0)>extract(epoch from clock_timestamp())*1000 then raise exception 'AI_ACCOUNT_TIMEOUT' using errcode='42501'; end if;
 day_start:=date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
 -- One lock covers user and project budgets across every Edge Function instance.
 perform pg_advisory_xact_lock(hashtextextended('nextbot-ai-budget',0));
 if exists(select 1 from nextbot_private.ai_requests where request_id=p_request_id) then raise exception 'AI_DUPLICATE'; end if;
 if exists(select 1 from nextbot_private.ai_requests where auth_id=p_auth_id and
 (created_at>clock_timestamp()-interval '10 seconds' or (status='reserved' and created_at>clock_timestamp()-interval '100 seconds')))
 then raise exception 'AI_BUSY'; end if;
 select count(*) into used_count from nextbot_private.ai_requests where auth_id=p_auth_id and created_at>=day_start;
 select count(*) into project_count from nextbot_private.ai_requests where created_at>=day_start;
 if used_count>=p_daily_limit or project_count>=p_project_limit then raise exception 'AI_LIMIT'; end if;
 insert into nextbot_private.ai_requests(request_id,auth_id) values(p_request_id,p_auth_id);
 return jsonb_build_object('remaining',p_daily_limit-used_count-1,'resetsAt',day_start+interval '1 day');
end $f$;
create or replace function public.nb_ai_finish(p_request_id uuid,p_status text,p_input integer default 0,p_output integer default 0)
returns void language plpgsql security definer set search_path='' as $f$
begin
 if p_status is null or p_status not in ('completed','failed') then raise exception 'invalid status'; end if;
 update nextbot_private.ai_requests set status=p_status,input_tokens=greatest(0,least(coalesce(p_input,0),1000000)),
 output_tokens=greatest(0,least(coalesce(p_output,0),1000000))
 where request_id=p_request_id and status='reserved';
end $f$;
revoke all on function public.nb_ai_reserve(uuid,uuid,integer,integer),public.nb_ai_finish(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.nb_ai_reserve(uuid,uuid,integer,integer),public.nb_ai_finish(uuid,text,integer,integer) to service_role;
commit;
select 'Grok 사용량 보호 설정 완료' as result;
