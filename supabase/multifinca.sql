-- CampControl · paso a varias fincas, dueños, trabajadores e historial
-- Ejecutar UNA vez en Supabase → SQL Editor, después de instalar.sql. Se puede repetir sin romper nada.
-- Los datos que ya existen pasan a la finca «Las Largas» y todos los usuarios actuales quedan como dueños.

-- ============ 1. Fincas y miembros ============
create table if not exists public.fincas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null check (length(trim(nombre)) between 1 and 60),
  codigo      text not null unique,
  creado      timestamptz not null default now(),
  creado_por  uuid
);

create table if not exists public.miembros (
  finca_id  uuid not null references public.fincas(id) on delete cascade,
  user_id   uuid not null,
  rol       text not null check (rol in ('dueno', 'trabajador')),
  nombre    text,
  email     text,
  unido     timestamptz not null default now(),
  primary key (finca_id, user_id)
);
create index if not exists miembros_user_idx on public.miembros (user_id);

create or replace function public.es_miembro(f uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros where finca_id = f and user_id = auth.uid())
$$;
create or replace function public.es_dueno(f uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros where finca_id = f and user_id = auth.uid() and rol = 'dueno')
$$;

-- Código de invitación: 6 caracteres sin letras que se confundan (sin O/0, I/1)
create or replace function public.nuevo_codigo() returns text
language plpgsql volatile set search_path = public as $$
declare c text; abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.fincas where codigo = c);
  end loop;
  return c;
end $$;

-- Fotos subidas antes de este cambio (sin carpeta de finca): se apuntan como de «Las Largas»
create table if not exists public.media_antigua (
  nombre    text primary key,
  finca_id  uuid not null references public.fincas(id) on delete cascade
);
alter table public.media_antigua enable row level security;
revoke all on public.media_antigua from anon, authenticated;

-- ============ 2. Registros por finca ============
alter table public.registros add column if not exists finca_id uuid references public.fincas(id) on delete cascade;

do $$
declare f uuid;
begin
  if exists (select 1 from public.registros where finca_id is null) then
    select id into f from public.fincas where nombre = 'Las Largas' order by creado limit 1;
    if f is null then
      insert into public.fincas (nombre, codigo) values ('Las Largas', public.nuevo_codigo()) returning id into f;
    end if;
    insert into public.miembros (finca_id, user_id, rol, nombre, email)
      select f, u.id, 'dueno', split_part(u.email, '@', 1), u.email from auth.users u
      on conflict (finca_id, user_id) do nothing;
    update public.registros set finca_id = f where finca_id is null;
    insert into public.media_antigua (nombre, finca_id)
      select o.name, f from storage.objects o where o.bucket_id = 'media'
      on conflict (nombre) do nothing;
  end if;
end $$;

alter table public.registros alter column finca_id set not null;
alter table public.registros drop constraint if exists registros_pkey;
alter table public.registros add primary key (finca_id, tabla, id);
drop index if exists public.registros_servidor_idx;
create index if not exists registros_finca_servidor_idx on public.registros (finca_id, servidor);

-- ============ 3. Historial (lo escribe el servidor; nadie lo puede tocar desde la app) ============
create table if not exists public.historial (
  id              bigserial primary key,
  finca_id        uuid not null references public.fincas(id) on delete cascade,
  tabla           text not null,
  registro_id     text not null,
  accion          text not null check (accion in ('crear', 'editar', 'borrar', 'restaurar')),
  usuario         uuid,
  usuario_nombre  text,
  cuando          timestamptz not null default now(),
  titulo          text,
  antes           jsonb,
  despues         jsonb
);
create index if not exists historial_finca_idx on public.historial (finca_id, cuando desc);

create or replace function public.registrar_historial() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  acc text; quien text; tit text; ult public.historial%rowtype;
begin
  if tg_op = 'UPDATE' and new.actualizado = old.actualizado and new.borrado = old.borrado then
    return null; -- solo han llegado rutas de fotos o un cambio antiguo ignorado
  end if;
  if tg_op = 'INSERT' then acc := case when new.borrado then 'borrar' else 'crear' end;
  elsif new.borrado and not old.borrado then acc := 'borrar';
  elsif old.borrado and not new.borrado then acc := 'restaurar';
  else acc := 'editar';
  end if;
  select nombre into quien from public.miembros where finca_id = new.finca_id and user_id = auth.uid();
  tit := coalesce(new.datos->>'titulo', new.datos->>'nombre', nullif(new.datos->>'producto', ''),
                  case when tg_op = 'UPDATE' then coalesce(old.datos->>'titulo', old.datos->>'nombre', nullif(old.datos->>'producto', '')) end);
  if acc = 'editar' then
    -- varias ediciones seguidas de la misma persona (p. ej. un recorrido grabándose) se juntan en una
    select * into ult from public.historial
      where finca_id = new.finca_id and tabla = new.tabla and registro_id = new.id
      order by cuando desc limit 1;
    if found and ult.accion in ('editar', 'crear') and ult.usuario is not distinct from auth.uid()
       and ult.cuando > now() - interval '10 minutes' then
      update public.historial set despues = new.datos #- '{recorrido,puntos}', cuando = now(), titulo = coalesce(tit, titulo)
        where id = ult.id;
      return null;
    end if;
  end if;
  insert into public.historial (finca_id, tabla, registro_id, accion, usuario, usuario_nombre, titulo, antes, despues)
  values (new.finca_id, new.tabla, new.id, acc, auth.uid(), quien, tit,
          case when tg_op = 'UPDATE' then (case when acc = 'borrar' then old.datos else old.datos #- '{recorrido,puntos}' end) end,
          new.datos #- '{recorrido,puntos}');
  return null;
end $$;
drop trigger if exists registros_historial on public.registros;
create trigger registros_historial after insert or update on public.registros
  for each row execute function public.registrar_historial();

-- ============ 4. Permisos (cada uno solo ve sus fincas) ============
alter table public.fincas enable row level security;
alter table public.miembros enable row level security;
alter table public.historial enable row level security;

drop policy if exists "familia" on public.registros;
drop policy if exists "miembros leen" on public.registros;
drop policy if exists "miembros crean" on public.registros;
drop policy if exists "miembros cambian" on public.registros;
create policy "miembros leen"    on public.registros for select to authenticated using (public.es_miembro(finca_id));
create policy "miembros crean"   on public.registros for insert to authenticated with check (public.es_miembro(finca_id));
create policy "miembros cambian" on public.registros for update to authenticated using (public.es_miembro(finca_id)) with check (public.es_miembro(finca_id));

drop policy if exists "ver mis fincas" on public.fincas;
create policy "ver mis fincas" on public.fincas for select to authenticated using (public.es_miembro(id));
revoke all on public.fincas from anon, authenticated;
grant select (id, nombre, creado) on public.fincas to authenticated; -- el código solo lo ve el dueño (función)

drop policy if exists "ver mi equipo" on public.miembros;
create policy "ver mi equipo" on public.miembros for select to authenticated using (public.es_miembro(finca_id));
revoke all on public.miembros from anon, authenticated;
grant select on public.miembros to authenticated;

drop policy if exists "dueño ve historial" on public.historial;
create policy "dueño ve historial" on public.historial for select to authenticated using (public.es_dueno(finca_id));
revoke all on public.historial from anon, authenticated;
grant select on public.historial to authenticated;

-- ============ 5. Acciones (funciones que llama la app) ============
create or replace function public.mis_fincas()
returns table (id uuid, nombre text, rol text, miembros bigint)
language sql stable security definer set search_path = public as $$
  select f.id, f.nombre, m.rol, (select count(*) from public.miembros x where x.finca_id = f.id)
  from public.miembros m join public.fincas f on f.id = m.finca_id
  where m.user_id = auth.uid() order by f.nombre
$$;

create or replace function public.crear_finca(p_nombre text, p_mi_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare f uuid; mail text;
begin
  if auth.uid() is null then raise exception 'Hay que entrar con una cuenta'; end if;
  if length(trim(coalesce(p_nombre, ''))) = 0 then raise exception 'La finca necesita un nombre'; end if;
  select email into mail from auth.users where id = auth.uid();
  insert into public.fincas (nombre, codigo, creado_por) values (trim(p_nombre), public.nuevo_codigo(), auth.uid()) returning id into f;
  insert into public.miembros (finca_id, user_id, rol, nombre, email) values (f, auth.uid(), 'dueno', nullif(trim(p_mi_nombre), ''), mail);
  return f;
end $$;

create or replace function public.unirse_finca(p_codigo text, p_mi_nombre text) returns json
language plpgsql security definer set search_path = public as $$
declare fin public.fincas%rowtype; mail text;
begin
  if auth.uid() is null then raise exception 'Hay que entrar con una cuenta'; end if;
  select * into fin from public.fincas where codigo = upper(regexp_replace(coalesce(p_codigo, ''), '\s', '', 'g'));
  if not found then raise exception 'Código no válido. Pídele al dueño el código de la finca'; end if;
  select email into mail from auth.users where id = auth.uid();
  insert into public.miembros (finca_id, user_id, rol, nombre, email) values (fin.id, auth.uid(), 'trabajador', nullif(trim(p_mi_nombre), ''), mail)
    on conflict (finca_id, user_id) do update set nombre = coalesce(excluded.nombre, public.miembros.nombre);
  return json_build_object('id', fin.id, 'nombre', fin.nombre);
end $$;

create or replace function public.codigo_finca(f uuid, renovar boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.es_dueno(f) then raise exception 'Solo el dueño puede ver el código'; end if;
  if renovar then update public.fincas set codigo = public.nuevo_codigo() where id = f; end if;
  select codigo into c from public.fincas where id = f;
  return c;
end $$;

create or replace function public.cambiar_rol(f uuid, u uuid, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno(f) then raise exception 'Solo el dueño puede cambiar los permisos'; end if;
  if p_rol not in ('dueno', 'trabajador') then raise exception 'Permiso no válido'; end if;
  if p_rol = 'trabajador' and (select count(*) from public.miembros where finca_id = f and rol = 'dueno' and user_id <> u) = 0 then
    raise exception 'La finca tiene que tener al menos un dueño';
  end if;
  update public.miembros set rol = p_rol where finca_id = f and user_id = u;
end $$;

create or replace function public.quitar_miembro(f uuid, u uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.es_dueno(f) or u = auth.uid()) then raise exception 'Solo el dueño puede quitar a alguien'; end if;
  if (select count(*) from public.miembros where finca_id = f and rol = 'dueno' and user_id <> u) = 0 then
    raise exception 'La finca tiene que tener al menos un dueño';
  end if;
  delete from public.miembros where finca_id = f and user_id = u;
end $$;

create or replace function public.renombrar_finca(f uuid, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_dueno(f) then raise exception 'Solo el dueño puede cambiar el nombre'; end if;
  update public.fincas set nombre = trim(p_nombre) where id = f;
end $$;

create or replace function public.mi_nombre(f uuid, p_nombre text) returns void
language sql security definer set search_path = public as $$
  update public.miembros set nombre = nullif(trim(p_nombre), '') where finca_id = f and user_id = auth.uid()
$$;

revoke execute on function public.mis_fincas(), public.crear_finca(text, text), public.unirse_finca(text, text),
  public.codigo_finca(uuid, boolean), public.cambiar_rol(uuid, uuid, text), public.quitar_miembro(uuid, uuid),
  public.renombrar_finca(uuid, text), public.mi_nombre(uuid, text), public.nuevo_codigo() from public, anon;
grant execute on function public.mis_fincas(), public.crear_finca(text, text), public.unirse_finca(text, text),
  public.codigo_finca(uuid, boolean), public.cambiar_rol(uuid, uuid, text), public.quitar_miembro(uuid, uuid),
  public.renombrar_finca(uuid, text), public.mi_nombre(uuid, text) to authenticated;

-- ============ 6. Fotos y vídeos: carpeta = id de la finca; solo sus miembros ============
create or replace function public.puede_media(p_nombre text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.media_antigua m where m.nombre = p_nombre)
      then exists (select 1 from public.media_antigua m where m.nombre = p_nombre and public.es_miembro(m.finca_id))
    when split_part(p_nombre, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.es_miembro(split_part(p_nombre, '/', 1)::uuid)
    else false
  end
$$;
grant execute on function public.puede_media(text) to authenticated;

drop policy if exists "familia lee media" on storage.objects;
drop policy if exists "familia sube media" on storage.objects;
drop policy if exists "familia cambia media" on storage.objects;
drop policy if exists "familia borra media" on storage.objects;
drop policy if exists "finca lee media" on storage.objects;
drop policy if exists "finca sube media" on storage.objects;
drop policy if exists "finca cambia media" on storage.objects;
drop policy if exists "finca borra media" on storage.objects;
create policy "finca lee media"    on storage.objects for select to authenticated using (bucket_id = 'media' and public.puede_media(name));
create policy "finca sube media"   on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.puede_media(name));
create policy "finca cambia media" on storage.objects for update to authenticated using (bucket_id = 'media' and public.puede_media(name));
create policy "finca borra media"  on storage.objects for delete to authenticated using (bucket_id = 'media' and public.puede_media(name));
