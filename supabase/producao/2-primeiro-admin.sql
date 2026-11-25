-- Torna administrador quem já criou conta no site e confirmou o e-mail.
-- Troque o e-mail abaixo pelo seu, cole no SQL Editor e clique em Run.
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where lower(email) = lower('SEU-EMAIL@exemplo.com')
on conflict do nothing;

-- Conferir (deve aparecer uma linha com o seu e-mail):
select u.email, r.role from public.user_roles r join auth.users u on u.id = r.user_id;
