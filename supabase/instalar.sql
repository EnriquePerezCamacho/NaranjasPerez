-- Las Largas · preparación de Supabase
-- Pega todo esto en Supabase → SQL Editor → New query → Run. Se puede ejecutar más de una vez.

-- 1) Tabla única: una fila por incidencia, parcela o tratamiento
create table if not exists public.registros (
  tabla        text        not null check (tabla in ('inc', 'parcelas', 'trat')),
  id           text        not null,
  datos        jsonb,
  borrado      boolean     not null default false,
  actualizado  bigint      not null,                -- momento del cambio en el móvil (ms)
  servidor     timestamptz not null default now(),  -- momento en que llegó al servidor
  autor        text,
  primary key (tabla, id)
);
create index if not exists registros_servidor_idx on public.registros (servidor);

-- 2) Si llega un cambio más antiguo que el guardado, se ignora (gana el último cambio)
create or replace function public.registros_antes_de_guardar() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.actualizado < old.actualizado then
    return old;
  end if;
  new.servidor := clock_timestamp();
  return new;
end $$;
drop trigger if exists registros_antes_de_guardar on public.registros;
create trigger registros_antes_de_guardar before insert or update on public.registros
  for each row execute function public.registros_antes_de_guardar();

-- 3) Solo los usuarios que hayan entrado con su cuenta pueden leer y escribir
alter table public.registros enable row level security;
drop policy if exists "familia" on public.registros;
create policy "familia" on public.registros for all to authenticated using (true) with check (true);

-- 4) Almacenamiento privado para fotos y vídeos
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;  -- 50 MB por archivo (límite del plan gratuito)

drop policy if exists "familia lee media" on storage.objects;
drop policy if exists "familia sube media" on storage.objects;
drop policy if exists "familia cambia media" on storage.objects;
drop policy if exists "familia borra media" on storage.objects;
create policy "familia lee media"    on storage.objects for select to authenticated using (bucket_id = 'media');
create policy "familia sube media"   on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "familia cambia media" on storage.objects for update to authenticated using (bucket_id = 'media');
create policy "familia borra media"  on storage.objects for delete to authenticated using (bucket_id = 'media');
