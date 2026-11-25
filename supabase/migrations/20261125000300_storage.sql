-- Resolve Aqui · armazenamento de fotos
-- Fotos são reprocessadas no servidor (sharp → WebP, sem EXIF/GPS) antes do envio.
-- Cada usuário só escreve na própria pasta: {user_id}/...

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 2097152, array['image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "fotos publicas" on storage.objects for select to anon, authenticated
  using (bucket_id = 'profile-photos');
create policy "dono envia na propria pasta" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dono atualiza na propria pasta" on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dono remove na propria pasta" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
