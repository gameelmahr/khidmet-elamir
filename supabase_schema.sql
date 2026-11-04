-- خدمة الأمير: مخطط تأسيسي. شغّله في SQL Editor بمشروع Supabase جديد.
create extension if not exists pgcrypto;

create table if not exists public.groups (
 id uuid primary key default gen_random_uuid(),
 name text unique not null
);
insert into public.groups(name) values
('روضة'),('حضانة'),('أولى وتانية'),('تالتة ورابعة'),('خامسة وسادسة'),('إعدادي'),('ثانوي')
on conflict(name) do nothing;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '',
 role text not null default 'servant' check(role in ('pending','servant','group_admin','super_admin')),
 status text not null default 'pending' check(status in ('pending','approved','disabled')),
 group_id uuid references public.groups(id),
 created_at timestamptz not null default now()
);
create table if not exists public.children (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id),
 full_name text not null,
 date_of_birth date,
 guardian_name text,
 guardian_phone text,
 school_grade text,
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.attendance (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public.groups(id),
 child_id uuid not null references public.children(id) on delete cascade,
 attendance_date date not null,
 status text not null check(status in ('present','absent','excused')),
 note text,
 created_at timestamptz not null default now(),
 unique(child_id,attendance_date)
);
create table if not exists public.audit_logs (
 id bigint generated always as identity primary key,
 actor_id uuid,
 actor_name text,
 action text not null,
 table_name text not null,
 record_id text,
 group_id uuid,
 created_at timestamptz not null default now()
);

create or replace function public.my_role() returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and status='approved' $$;
create or replace function public.my_group() returns uuid language sql stable security definer set search_path=public
as $$ select group_id from public.profiles where id=auth.uid() and status='approved' $$;
create or replace function public.is_global_admin() returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.my_role()='super_admin',false) $$;
create or replace function public.can_access_group(g uuid) returns boolean language sql stable security definer set search_path=public
as $$ select public.is_global_admin() or (public.my_role() in ('group_admin','servant') and public.my_group()=g) $$;

alter table public.groups enable row level security;
alter table public.profiles enable row level security;
alter table public.children enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_logs enable row level security;

create policy "approved users read groups" on public.groups for select to authenticated using (public.my_role() in ('super_admin','group_admin','servant'));
create policy "read own profile or global admin" on public.profiles for select to authenticated using (id=auth.uid() or public.is_global_admin());
create policy "global admin manage profiles" on public.profiles for all to authenticated using (public.is_global_admin()) with check (public.is_global_admin());
create policy "users read children in own group" on public.children for select to authenticated using (public.can_access_group(group_id));
create policy "admins manage children" on public.children for insert to authenticated with check (public.is_global_admin() or (public.my_role()='group_admin' and public.my_group()=group_id));
create policy "admins update children" on public.children for update to authenticated using (public.is_global_admin() or (public.my_role()='group_admin' and public.my_group()=group_id)) with check (public.is_global_admin() or (public.my_role()='group_admin' and public.my_group()=group_id));
create policy "global admin delete children" on public.children for delete to authenticated using (public.is_global_admin());
create policy "group users read attendance" on public.attendance for select to authenticated using (public.can_access_group(group_id));
create policy "group users record attendance" on public.attendance for insert to authenticated with check (public.can_access_group(group_id));
create policy "group users update attendance" on public.attendance for update to authenticated using (public.can_access_group(group_id)) with check (public.can_access_group(group_id));
create policy "admins read audit" on public.audit_logs for select to authenticated using (public.is_global_admin() or (public.my_role()='group_admin' and group_id=public.my_group()));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public
as $$
declare gid uuid;
begin
 select id into gid from public.groups where name=coalesce(new.raw_user_meta_data->>'requested_group','');
 insert into public.profiles(id,full_name,role,status,group_id)
 values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''), 'pending','pending',gid)
 on conflict(id) do nothing;
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.write_audit() returns trigger language plpgsql security definer set search_path=public
as $$
declare rid text; gid uuid; act text;
begin
 if TG_OP='DELETE' then rid:=old.id::text; gid:=old.group_id; act:='حذف'; else rid:=new.id::text; gid:=new.group_id; act:=case when TG_OP='INSERT' then 'إضافة' else 'تعديل' end; end if;
 insert into public.audit_logs(actor_id,actor_name,action,table_name,record_id,group_id)
 values(auth.uid(),(select full_name from public.profiles where id=auth.uid()),act,TG_TABLE_NAME,rid,gid);
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists children_audit on public.children;
create trigger children_audit after insert or update or delete on public.children for each row execute procedure public.write_audit();
drop trigger if exists attendance_audit on public.attendance;
create trigger attendance_audit after insert or update or delete on public.attendance for each row execute procedure public.write_audit();

-- بعد إنشاء أول حساب أبونا/الأمين العام، عيّنه يدويًا من SQL Editor:
-- update public.profiles set role='super_admin', status='approved', group_id=null
-- where id=(select id from auth.users where email='YOUR-ADMIN-EMAIL');
-- تعيين أمين مجموعة:
-- update public.profiles set role='group_admin', status='approved',
-- group_id=(select id from public.groups where name='تالتة ورابعة')
-- where id=(select id from auth.users where email='GROUP-ADMIN-EMAIL');
-- لا تشارك service_role key. راجع الدليل قبل إدخال بيانات أطفال حقيقية.
