-- NEXTBOT: operational Supabase backend. No personal seed data in this file.
begin;
create schema if not exists nextbot_private;
revoke all on schema nextbot_private from public, anon, authenticated;
create table if not exists public.nb_records (
  path text primary key check(path ~ '^[^/]+/[^/]+(/[^/]+)*$'),
  parent text generated always as (regexp_replace(path,'/[^/]+$','')) stored,
  data jsonb not null check(jsonb_typeof(data)='object'),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
create index if not exists nb_records_parent on public.nb_records(parent,path);
create table if not exists nextbot_private.identities(
  auth_id uuid primary key references auth.users(id) on delete cascade,
  legacy_uid text unique not null
);
alter table public.nb_records enable row level security;
revoke all on public.nb_records from public, anon, authenticated;
grant select on public.nb_records to authenticated;

create or replace function nextbot_private.actor() returns jsonb
language sql stable security definer set search_path=''
as $f$
select r.data || jsonb_build_object('uid',i.legacy_uid)
from nextbot_private.identities i
join public.nb_records r on r.path='users/'||i.legacy_uid
join auth.users u on u.id=i.auth_id
where i.auth_id=auth.uid() and u.email_confirmed_at is not null
  and coalesce((r.data->>'disabled')::boolean,false)=false
$f$;

create or replace function nextbot_private.team(p_path text,p_data jsonb) returns text
language sql immutable set search_path=''
as $f$
select coalesce(nullif(p_data->>'team',''),
case when split_part(p_path,'/',1)='users' and lower(split_part(p_data->>'email','@',2))='zeropoint.co.kr' then 'cce'
 when split_part(p_path,'/',2) like 'cce-%' or split_part(p_path,'/',2) like 'cce_%' or p_path='settings/dday-cce' then 'cce'
 else 'robofest' end)
$f$;

create or replace function nextbot_private.can_channel(p_id text,a jsonb) returns boolean
language sql stable security definer set search_path=''
as $f$
select a is not null and exists(
 select 1 from public.nb_records r where r.path='channels/'||p_id and (
 coalesce((a->>'isAdmin')::boolean,false) or (
 nextbot_private.team(r.path,r.data)=a->>'team'
 and not coalesce((r.data->>'archived')::boolean,false)
 and (coalesce(jsonb_array_length(r.data->'allowedRoles'),0)=0
      or coalesce(r.data->'allowedRoles','[]') ?| array(select jsonb_array_elements_text(a->'roles')))
 )))
$f$;

create or replace function public.nb_can_read(p_path text,p_data jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $f$
declare a jsonb:=nextbot_private.actor(); parts text[]:=string_to_array(p_path,'/'); root text;
begin
 if a is null then return false; end if;
 root:=parts[1];
 if root='rt' then
   if parts[2]='presence' then
     return exists(select 1 from public.nb_records u where u.path='users/'||parts[3]
       and (a->>'isAdmin'='true' or nextbot_private.team(u.path,u.data)=a->>'team'));
   elsif parts[2]='typing' then return nextbot_private.can_channel(parts[3],a);
   elsif parts[2]='notifications' then return parts[3]=a->>'uid';
   elsif parts[2]='admin_health' then return a->>'isAdmin'='true';
   else return false; end if;
 end if;
 if array_length(parts,1)=4 and root='channels' and parts[3]='messages' then
   return nextbot_private.can_channel(parts[2],a);
 end if;
 if array_length(parts,1)<>2 then return false; end if;
 if root in ('admin_logs','admin_health') then return a->>'isAdmin'='true'; end if;
 if root='settings' and parts[2] in ('app','bot','botStats') then return true; end if;
 if root not in ('users','categories','channels','settings','stats','mvp_weeks','announcements','events','tests','strategies','missions','practices','records') then return false; end if;
 if a->>'isAdmin'='true' then return true; end if;
 if nextbot_private.team(p_path,p_data)<>a->>'team' then return false; end if;
 if root='channels' then return nextbot_private.can_channel(parts[2],a); end if;
 return true;
end
$f$;
drop policy if exists nb_read on public.nb_records;
create policy nb_read on public.nb_records for select to authenticated using(public.nb_can_read(path,data));

create or replace function public.nb_identity() returns jsonb
language plpgsql security definer set search_path='' as $f$
declare u auth.users%rowtype; uid text; d jsonb; newteam text;
begin
 select * into u from auth.users where id=auth.uid();
 if u.id is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
 if u.email_confirmed_at is null then raise exception '이메일 인증을 먼저 완료해주세요.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('identity:'||lower(u.email),0));
 select i.legacy_uid into uid from nextbot_private.identities i where i.auth_id=u.id;
 if uid is null then
   select split_part(path,'/',2) into uid from public.nb_records
    where parent='users' and lower(data->>'email')=lower(u.email);
   if uid is null then
     uid:=u.id::text;
     newteam:=case when lower(split_part(u.email,'@',2))='zeropoint.co.kr' then 'cce' else 'robofest' end;
     d:=jsonb_build_object('email',lower(u.email),'nickname',left(coalesce(nullif(u.raw_user_meta_data->>'nickname',''),split_part(u.email,'@',1)),40),
       'team',newteam,'roles',jsonb_build_array('member'),'isAdmin',false,'disabled',false,'photoURL','','botTokens',0,
       'createdAt',jsonb_build_object('$ts',floor(extract(epoch from now())*1000)));
     insert into public.nb_records(path,data) values('users/'||uid,d);
   end if;
   insert into nextbot_private.identities(auth_id,legacy_uid) values(u.id,uid)
    on conflict(auth_id) do nothing;
 end if;
 select data into d from public.nb_records where path='users/'||uid;
 if d is null then raise exception '회원 정보를 찾을 수 없습니다.'; end if;
 if coalesce((d->>'disabled')::boolean,false) then raise exception '관리자에 의해 비활성화된 계정입니다.' using errcode='42501'; end if;
 return d||jsonb_build_object('uid',uid);
end
$f$;

create or replace function nextbot_private.put_at(base jsonb,parts text[],value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare child jsonb;
begin
 if cardinality(parts)=0 then return value; end if;
 if cardinality(parts)=1 then return jsonb_set(coalesce(base,'{}'),parts,value,true); end if;
 child:=nextbot_private.put_at(case when jsonb_typeof(base->parts[1])='object' then base->parts[1] else '{}'::jsonb end,parts[2:],value);
 return jsonb_set(coalesce(base,'{}'),array[parts[1]],child,true);
end
$f$;
create or replace function nextbot_private.value_at(oldval jsonb,newval jsonb) returns jsonb
language plpgsql set search_path='' as $f$
declare op text:=newval->>'__op'; result jsonb; k text; v jsonb;
begin
 if op='timestamp' then return jsonb_build_object('$ts',floor(extract(epoch from now())*1000));
 elsif op='increment' then return to_jsonb(coalesce((oldval#>>'{}')::numeric,0)+(newval->>'value')::numeric);
 elsif op in ('union','remove') then
   result:=case when jsonb_typeof(oldval)='array' then oldval else '[]'::jsonb end;
   for v in select value from jsonb_array_elements(newval->'values') loop
     if op='union' and not result @> jsonb_build_array(v) then result:=result||jsonb_build_array(v);
     elsif op='remove' then select coalesce(jsonb_agg(x),'[]') into result from jsonb_array_elements(result) x where x<>v;
     end if;
   end loop;
   return result;
 elsif op is not null then raise exception '지원하지 않는 필드 연산입니다.';
 end if;
 if jsonb_typeof(newval)='object' then
   result:='{}';
   for k,v in select key,value from jsonb_each(newval) loop
     result:=result||jsonb_build_object(k,nextbot_private.value_at(null,v));
   end loop;
   return result;
 elsif jsonb_typeof(newval)='array' then
   select coalesce(jsonb_agg(nextbot_private.value_at(null,x)),'[]') into result from jsonb_array_elements(newval) x;
   return result;
 end if;
 return newval;
end
$f$;
create or replace function nextbot_private.patch(base jsonb,patch jsonb,merge_objects boolean,dotted boolean) returns jsonb
language plpgsql set search_path='' as $f$
declare result jsonb:=coalesce(base,'{}'); k text; v jsonb; oldval jsonb; parts text[]; resolved jsonb;
begin
 for k,v in select key,value from jsonb_each(patch) loop
   parts:=case when dotted then string_to_array(k,'.') else array[k] end;
   oldval:=result#>parts;
   if merge_objects and jsonb_typeof(v)='object' and not(v?'__op') then
     resolved:=nextbot_private.patch(case when jsonb_typeof(oldval)='object' then oldval else '{}' end,v,true,false);
   else resolved:=nextbot_private.value_at(oldval,v); end if;
   result:=nextbot_private.put_at(result,parts,resolved);
 end loop;
 return result;
end
$f$;

create or replace function nextbot_private.without_actor(v jsonb,uid text) returns jsonb
language plpgsql immutable set search_path='' as $f$
declare result jsonb:='{}'; k text; ar jsonb;
begin
 if jsonb_typeof(v) is distinct from 'object' and v is not null then raise exception '리액션 형식 오류'; end if;
 for k,ar in select key,value from jsonb_each(coalesce(v,'{}')) loop
   if jsonb_typeof(ar) is distinct from 'array' then raise exception '리액션 형식 오류'; end if;
   select coalesce(jsonb_agg(x),'[]') into ar from jsonb_array_elements(ar) x where x<>to_jsonb(uid);
   if (select count(*) from jsonb_array_elements(coalesce(v->k,'[]')) x where x=to_jsonb(uid))>1 then raise exception '중복 리액션은 허용되지 않습니다.'; end if;
   if ar<>'[]'::jsonb then result:=result||jsonb_build_object(k,ar); end if;
 end loop;
 return result;
end
$f$;

create or replace function nextbot_private.bump_stat(team text,uid text,field text,delta integer) returns void
language plpgsql security definer set search_path='' as $f$
declare wk text:=to_char(date_trunc('week',now() at time zone 'Asia/Seoul'),'YYYY-MM-DD'); p text;
begin
 if uid is null or uid='BOT' or delta=0 then return; end if;
 p:='stats/'||team||'_'||wk;
 insert into public.nb_records(path,data) values(p,jsonb_build_object('team',team,'weekId',wk,field,jsonb_build_object(uid,greatest(0,delta))))
 on conflict(path) do update set data=nextbot_private.put_at(nb_records.data,array[field,uid],
   to_jsonb(greatest(0,coalesce((nb_records.data#>>array[field,uid])::integer,0)+delta))),
   version=nb_records.version+1,updated_at=now();
end
$f$;
create or replace function nextbot_private.reaction_count(v jsonb) returns integer
language sql immutable set search_path='' as $f$
select coalesce(sum(jsonb_array_length(value)),0)::integer from jsonb_each(coalesce(v,'{}'))
$f$;

create or replace function public.nb_commit(p_writes jsonb) returns void
language plpgsql security definer set search_path='' as $f$
declare a jsonb:=nextbot_private.actor(); w jsonb; p text; parts text[]; oldrow public.nb_records%rowtype;
 d jsonb; admin boolean; manager boolean; same_team boolean; root text; ch jsonb; locked boolean;
 uid text; oldopt jsonb; newopt jsonb; i integer; changed text[]; meta jsonb;
begin
 if a is null then raise exception '로그인 또는 계정 활성화가 필요합니다.' using errcode='42501'; end if;
 if jsonb_typeof(p_writes) is distinct from 'array' or jsonb_array_length(p_writes)>100 then raise exception '잘못된 일괄 작업입니다.'; end if;
 admin:=coalesce((a->>'isAdmin')::boolean,false);
 manager:=admin or coalesce(a->'roles','[]') ?| array['leader','teacher'];
 uid:=a->>'uid';
 for p in select distinct value->>'path' from jsonb_array_elements(p_writes) order by 1 loop
   perform pg_advisory_xact_lock(hashtextextended(p,0));
 end loop;
 for w in select value from jsonb_array_elements(p_writes) loop
   p:=w->>'path'; parts:=string_to_array(p,'/'); root:=parts[1];
   if p is null or p !~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)+$' or length(p)>500 then raise exception '잘못된 경로입니다.'; end if;
   if w->>'op' not in ('set','update','delete') then raise exception '지원하지 않는 작업입니다.'; end if;
   select * into oldrow from public.nb_records where path=p for update;
   if w?'expectedVersion' and (w->>'expectedVersion')::bigint <> coalesce(oldrow.version,0) then
     raise exception '다른 사용자가 먼저 수정했습니다. 다시 시도해주세요.' using errcode='40001';
   end if;
   if w->>'op'='update' and oldrow.path is null then raise exception '수정할 데이터가 없습니다.'; end if;
   if w->>'op'='delete' then d:='{}';
   else
     if jsonb_typeof(w->'data') is distinct from 'object' then raise exception '데이터는 객체여야 합니다.'; end if;
     d:=nextbot_private.patch(case when w->>'op'='update' or coalesce((w->>'merge')::boolean,false) then oldrow.data else '{}' end,
        w->'data',coalesce((w->>'merge')::boolean,false),w->>'op'='update');
   end if;

   if root='rt' then
     if parts[2]='presence' then
       if parts[3]<>uid or cardinality(parts)<>4 then raise exception '다른 회원의 접속 상태를 변경할 수 없습니다.' using errcode='42501'; end if;
       d:=d||jsonb_build_object('nickname',a->>'nickname','last_changed',floor(extract(epoch from now())*1000));
     elsif parts[2]='typing' then
       if cardinality(parts)<>4 or parts[4]<>uid or not nextbot_private.can_channel(parts[3],a) then raise exception '입력 상태 권한이 없습니다.' using errcode='42501'; end if;
       d:=d||jsonb_build_object('nickname',a->>'nickname','last_changed',floor(extract(epoch from now())*1000));
     elsif parts[2]='notifications' then
       if cardinality(parts)<>4 then raise exception '잘못된 알림 경로입니다.'; end if;
       if oldrow.path is not null then
         if parts[3]<>uid then raise exception '다른 회원의 알림은 수정할 수 없습니다.' using errcode='42501'; end if;
         if w->>'op'<>'delete' and d-'read' is distinct from oldrow.data-'read' then raise exception '읽음 상태만 변경할 수 있습니다.'; end if;
       else
         if w->>'op'='delete' then continue; end if;
         if not nextbot_private.can_channel(d->>'channelId',a) then raise exception '알림 채널 권한이 없습니다.'; end if;
         if not exists(select 1 from public.nb_records u where u.path='users/'||parts[3]
           and (admin or nextbot_private.team(u.path,u.data)=a->>'team')) then raise exception '알림 수신자 권한이 없습니다.'; end if;
         d:=d||jsonb_build_object('fromNickname',a->>'nickname','fromUid',uid,'read',false,'createdAt',floor(extract(epoch from now())*1000));
       end if;
     elsif parts[2]='admin_health' then
       if not admin or parts[3]<>uid then raise exception '관리자 전용입니다.'; end if;
     else raise exception '지원하지 않는 실시간 경로입니다.'; end if;

   elsif root='users' and cardinality(parts)=2 then
     if oldrow.path is null or w->>'op'='delete' then raise exception '회원 생성/삭제는 인증 서버에서 처리합니다.'; end if;
     if not admin then
       if parts[2]<>uid or d-array['nickname','photoURL','contactEmail','readState','lastSeen','pendingBotTasks']
           is distinct from oldrow.data-array['nickname','photoURL','contactEmail','readState','lastSeen','pendingBotTasks'] then
         raise exception '회원 권한/토큰/소속은 관리자만 변경할 수 있습니다.' using errcode='42501';
       end if;
     end if;
     if d->>'email' is distinct from oldrow.data->>'email' then raise exception '로그인 이메일은 인증 서버에서 변경해야 합니다.'; end if;
     if jsonb_typeof(d->'roles') is distinct from 'array' or exists(
       select 1 from jsonb_array_elements_text(d->'roles') r where r not in ('leader','teacher','member','coding','making')) then raise exception '잘못된 역할입니다.'; end if;
     if jsonb_typeof(d->'isAdmin') is distinct from 'boolean' or jsonb_typeof(d->'disabled') is distinct from 'boolean'
       or d->>'team' not in ('robofest','cce') then raise exception '회원 상태 형식이 올바르지 않습니다.'; end if;
     if length(d->>'nickname') not between 1 and 40 then raise exception '닉네임은 1~40자여야 합니다.'; end if;
     if oldrow.data->>'isAdmin'='true' and (coalesce(d->>'isAdmin','false')<>'true' or d->>'disabled'='true') and not exists(
       select 1 from public.nb_records u where u.parent='users' and u.path<>p and u.data->>'isAdmin'='true' and coalesce(u.data->>'disabled','false')<>'true') then
       raise exception '마지막 활성 관리자는 해제할 수 없습니다.';
     end if;

   elsif root='channels' and cardinality(parts)=4 and parts[3]='messages' then
     if not nextbot_private.can_channel(parts[2],a) then raise exception '채널 접근 권한이 없습니다.' using errcode='42501'; end if;
     select data into ch from public.nb_records where path='channels/'||parts[2];
     if not admin and coalesce((ch->>'locked')::boolean,false) then raise exception '잠긴 채널입니다.'; end if;
     if not admin and coalesce((a->>'timeoutUntil')::numeric,0)>extract(epoch from now())*1000 then raise exception '타임아웃 중에는 메시지를 변경할 수 없습니다.'; end if;
     if w->>'op'='delete' then
       if oldrow.path is not null and not admin and (oldrow.data->>'userId' is distinct from uid) and (oldrow.data->>'botActorUid' is distinct from uid) then raise exception '다른 회원의 메시지를 삭제할 수 없습니다.'; end if;
     elsif oldrow.path is null then
       if d->>'isBot'='true' then
         d:=d||jsonb_build_object('botActorUid',uid,'botActorNickname',a->>'nickname');
       end if;
       if d->>'userId'='BOT' and d->>'isBot'='true' then
         d:=d||jsonb_build_object('botActorUid',uid,'botActorNickname',a->>'nickname');
       elsif d->>'userId' is distinct from uid then raise exception '다른 회원으로 메시지를 보낼 수 없습니다.'; end if;
       d:=d||jsonb_build_object('reactions','{}'::jsonb);
       if d->>'type'='poll' then
         select jsonb_agg(opt||jsonb_build_object('votes','[]'::jsonb)) into meta from jsonb_array_elements(d->'options') opt;
         d:=d||jsonb_build_object('options',meta);
       end if;
       if coalesce((d->>'pinned')::boolean,false) and not manager then raise exception '메시지 고정 권한이 없습니다.'; end if;
       d:=d||jsonb_build_object('team',nextbot_private.team('channels/'||parts[2],ch),'createdAt',jsonb_build_object('$ts',floor(extract(epoch from now())*1000)));
     else
       if d-array['content','editedAt','edited','pinned','reactions','options'] is distinct from oldrow.data-array['content','editedAt','edited','pinned','reactions','options'] then
         raise exception '메시지 작성자와 원본 정보는 변경할 수 없습니다.';
       end if;
       if d->'pinned' is distinct from oldrow.data->'pinned' and not manager then raise exception '고정 권한이 없습니다.'; end if;
       if d-array['pinned','reactions','options'] is distinct from oldrow.data-array['pinned','reactions','options']
         and not admin and (oldrow.data->>'userId' is distinct from uid) and (oldrow.data->>'botActorUid' is distinct from uid) then raise exception '다른 회원의 메시지를 편집할 수 없습니다.'; end if;
       if nextbot_private.without_actor(d->'reactions',uid) is distinct from nextbot_private.without_actor(oldrow.data->'reactions',uid) then
         raise exception '다른 회원의 리액션은 변경할 수 없습니다.';
       end if;
       if d->'options' is distinct from oldrow.data->'options' then
         if jsonb_typeof(d->'options') is distinct from 'array' or jsonb_array_length(d->'options')<>jsonb_array_length(oldrow.data->'options') then raise exception '투표 항목은 변경할 수 없습니다.'; end if;
         for i in 0..jsonb_array_length(d->'options')-1 loop
           oldopt:=oldrow.data->'options'->i; newopt:=d->'options'->i;
           if (select count(*) from jsonb_array_elements(newopt->'votes') x where x=to_jsonb(uid))>1 then raise exception '중복 투표는 허용되지 않습니다.'; end if;
           if oldopt-'votes' is distinct from newopt-'votes' or
             (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(oldopt->'votes') x where x<>to_jsonb(uid))
             is distinct from
             (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(newopt->'votes') x where x<>to_jsonb(uid))
           then raise exception '다른 회원의 투표는 변경할 수 없습니다.'; end if;
         end loop;
       end if;
     end if;
     if w->>'op'<>'delete' then
       if d?'content' and jsonb_typeof(d->'content') is distinct from 'string' then raise exception '메시지 내용은 문자열이어야 합니다.'; end if;
       if d?'attachments' and (jsonb_typeof(d->'attachments') is distinct from 'array' or jsonb_array_length(d->'attachments')>20) then raise exception '첨부 형식이 올바르지 않습니다.'; end if;
       if d?'replyTo' and d->'replyTo'<>'null'::jsonb and
          (jsonb_typeof(d->'replyTo') is distinct from 'object' or jsonb_typeof(d->'replyTo'->'snippet') is distinct from 'string') then raise exception '답장 형식이 올바르지 않습니다.'; end if;
       if d->>'type'='poll' and (jsonb_typeof(d->'question') is distinct from 'string' or
         jsonb_typeof(d->'options') is distinct from 'array' or jsonb_array_length(d->'options') not between 2 and 20) then raise exception '투표 형식이 올바르지 않습니다.'; end if;
     end if;
     if w->>'op'<>'delete' and coalesce(octet_length(d::text),0)>900000 then raise exception '메시지와 첨부 데이터가 너무 큽니다.'; end if;

   elsif cardinality(parts)=2 then
     if root not in ('categories','channels','settings','stats','mvp_weeks','announcements','events','tests','strategies','missions','practices','records','admin_logs','admin_health') then raise exception '지원하지 않는 데이터입니다.'; end if;
     if root in ('categories','channels','settings','stats','admin_logs','admin_health') and not admin then raise exception '관리자 전용 작업입니다.' using errcode='42501'; end if;
     if root='mvp_weeks' and not manager then raise exception 'MVP 관리 권한이 없습니다.'; end if;
     if root='admin_logs' then
       if oldrow.path is not null or w->>'op'='delete' then raise exception '감사 로그는 수정/삭제할 수 없습니다.'; end if;
       d:=d||jsonb_build_object('adminUid',uid,'adminNickname',a->>'nickname','createdAt',jsonb_build_object('$ts',floor(extract(epoch from now())*1000)));
     end if;
     if root='channels' and w->>'op'<>'delete' and not exists(
       select 1 from public.nb_records cat where cat.path='categories/'||(d->>'categoryId')
       and nextbot_private.team(cat.path,cat.data)=nextbot_private.team(p,d)) then raise exception '채널의 카테고리와 소속 팀을 확인해주세요.'; end if;
     if root='categories' and w->>'op'='delete' and exists(
       select 1 from public.nb_records c where c.parent='channels' and c.data->>'categoryId'=parts[2]) then raise exception '하위 채널을 먼저 삭제해주세요.'; end if;
     if root='settings' and parts[2]='bot' and coalesce(d->>'apiKey','')<>'' then raise exception '비밀 API 키는 서버 함수에 저장해야 합니다.'; end if;
     if root not in ('settings','admin_logs','admin_health') then
       if oldrow.path is null and w->>'op'<>'delete' then
         d:=d||jsonb_build_object('team',coalesce(nullif(d->>'team',''),a->>'team'));
       end if;
       if not admin and ((oldrow.path is not null and nextbot_private.team(p,oldrow.data)<>a->>'team') or (w->>'op'<>'delete' and nextbot_private.team(p,d)<>a->>'team')) then raise exception '다른 팀의 데이터를 변경할 수 없습니다.'; end if;
       if root in ('announcements','events') and not manager then raise exception '공지/일정 관리 권한이 없습니다.'; end if;
       if root in ('tests','strategies','missions','practices','records') then
         if oldrow.path is null then d:=d||jsonb_build_object('userId',uid);
         elsif not manager and oldrow.data->>'userId' is distinct from uid then raise exception '다른 회원의 기록은 수정할 수 없습니다.'; end if;
         if oldrow.path is not null and d->>'userId' is distinct from oldrow.data->>'userId' and w->>'op'<>'delete' then raise exception '기록 작성자는 변경할 수 없습니다.'; end if;
       end if;
     end if;
   else raise exception '지원하지 않는 데이터 경로입니다.'; end if;

   if w->>'op'='delete' then
     delete from public.nb_records where path=p;
     if root='channels' and cardinality(parts)=2 then delete from public.nb_records where parent=p||'/messages'; end if;
   else
     insert into public.nb_records(path,data) values(p,d)
     on conflict(path) do update set data=excluded.data,version=nb_records.version+1,updated_at=now();
   end if;
   if root='channels' and cardinality(parts)=4 then
     if oldrow.path is null and w->>'op'<>'delete' then
       update public.nb_records set data=data||jsonb_build_object('lastMessageAt',jsonb_build_object('$ts',floor(extract(epoch from now())*1000))),version=version+1,updated_at=now()
       where path='channels/'||parts[2];
     end if;
     if oldrow.path is null and w->>'op'<>'delete' and coalesce(d->>'isBot','false')<>'true' then
       perform nextbot_private.bump_stat(nextbot_private.team('channels/'||parts[2],ch),uid,'msgCount',1);
     end if;
     if oldrow.path is not null and w->>'op'<>'delete' then
       perform nextbot_private.bump_stat(nextbot_private.team('channels/'||parts[2],ch),oldrow.data->>'userId','reactCount',
        nextbot_private.reaction_count(d->'reactions')-nextbot_private.reaction_count(oldrow.data->'reactions'));
     end if;
   end if;
 end loop;
end
$f$;

revoke all on all functions in schema nextbot_private from public, anon, authenticated;
revoke all on function public.nb_can_read(text,jsonb),public.nb_identity(),public.nb_commit(jsonb) from public,anon;
grant execute on function public.nb_can_read(text,jsonb),public.nb_identity(),public.nb_commit(jsonb) to authenticated;

-- Import the already validated private backup, without overwriting later live edits.
do $import$
declare r record; d jsonb; team text;
begin
 if to_regclass('nextbot_migration.backup_documents') is null then raise exception '02 SQL을 먼저 실행해주세요.'; end if;
 for r in select path,source_data from nextbot_migration.backup_documents
   where backup_id='nextbot-admin-2026-10-26T07:00:05.545Z' loop
   d:=r.source_data;
   team:=nextbot_private.team(r.path,d);
   if split_part(r.path,'/',1) in ('users','categories','channels') then d:=d||jsonb_build_object('team',team); end if;
   if split_part(r.path,'/',1)='users' then d:=(d-array['readState','pendingBotTasks'])||jsonb_build_object('readState','{}'::jsonb); end if;
   if split_part(r.path,'/',1)='channels' then d:=d-'lastMessageAt'; end if;
   insert into public.nb_records(path,data) values(r.path,d) on conflict(path) do nothing;
 end loop;
end
$import$;
do $pub$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
  and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='nb_records')
 then alter publication supabase_realtime add table public.nb_records; end if;
end
$pub$;

-- Bounded, server-side filtering and ordering for the compatibility client.
create or replace function public.nb_query(p_parent text,p_filters jsonb default '[]',p_order text default null,p_desc boolean default false,p_limit integer default 1000,p_offset integer default 0)
returns setof public.nb_records language sql stable security invoker set search_path='' as $f$
select r.* from public.nb_records r
where r.parent=p_parent and (p_order is null or r.data ? p_order)
and not exists(
 select 1 from jsonb_array_elements(p_filters) f
 where not coalesce(case f->>'op'
  when '==' then (r.data#>string_to_array(f->>'field','.'))=f->'value'
  when '>=' then (r.data#>string_to_array(f->>'field','.'))>=f->'value'
  when '<=' then (r.data#>string_to_array(f->>'field','.'))<=f->'value'
  when '>' then (r.data#>string_to_array(f->>'field','.'))>f->'value'
  when '<' then (r.data#>string_to_array(f->>'field','.'))<f->'value'
  when 'in' then (f->'value') @> jsonb_build_array(r.data#>string_to_array(f->>'field','.'))
  when 'array-contains' then (r.data#>string_to_array(f->>'field','.')) @> jsonb_build_array(f->'value')
  else false end,false))
order by case when not p_desc then case when p_order is null then to_jsonb(r.path) else r.data->p_order end end asc,
 case when p_desc then case when p_order is null then to_jsonb(r.path) else r.data->p_order end end desc,r.path
limit least(greatest(p_limit,1),1000) offset greatest(p_offset,0)
$f$;
revoke all on function public.nb_query(text,jsonb,text,boolean,integer,integer) from public,anon;
grant execute on function public.nb_query(text,jsonb,text,boolean,integer,integer) to authenticated;

commit;
select count(*) filter(where parent='users') as users,
 count(*) filter(where parent='categories') as categories,
 count(*) filter(where parent='channels') as channels,
 count(*) filter(where parent='settings') as settings from public.nb_records;
