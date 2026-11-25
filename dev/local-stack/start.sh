#!/usr/bin/env bash
# Sobe uma "mini Supabase" local SEM Docker, usada para rodar os testes deste projeto:
# Postgres 16 + GoTrue (supabase/auth v2.177.0) + PostgREST v12.2.3 + gateway (storage simplificado e caixa de e-mails).
# Preferência: se você tem Docker, use `supabase start` (CLI oficial) em vez deste script.
set -euo pipefail
ROOT=${MINISB_DIR:-/opt/minisb}
HERE="$(cd "$(dirname "$0")" && pwd)"
PG=/usr/lib/postgresql/16/bin
JWT=super-secret-jwt-token-with-at-least-32-characters-long
mkdir -p "$ROOT" && cd "$ROOT"
[ -x auth ] || { curl -sSL https://github.com/supabase/auth/releases/download/v2.177.0/auth-v2.177.0-x86.tar.gz | tar xz; }
[ -x postgrest ] || { curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar xJ; }
if [ ! -d pgdata ]; then
  mkdir pgdata && chown postgres pgdata && touch pg.log && chown postgres pg.log
  su postgres -c "$PG/initdb -D $ROOT/pgdata -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
  NEW=1
fi
su postgres -c "$PG/pg_ctl -D $ROOT/pgdata -o '-p 54322 -k /tmp' -l $ROOT/pg.log start" || true
sleep 2
if [ "${NEW:-0}" = 1 ]; then psql -q -h localhost -p 54322 -U postgres -f "$HERE/bootstrap.sql"; fi
cat > auth.env <<ENV
GOTRUE_API_HOST=127.0.0.1
PORT=9999
API_EXTERNAL_URL=http://localhost:54321/auth/v1
GOTRUE_DB_DRIVER=postgres
GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:authpass@localhost:54322/postgres?search_path=auth
GOTRUE_SITE_URL=http://localhost:3000
GOTRUE_URI_ALLOW_LIST=http://localhost:3000/**
GOTRUE_JWT_SECRET=$JWT
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_JWT_ADMIN_ROLES=service_role
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_SMTP_HOST=127.0.0.1
GOTRUE_SMTP_PORT=2500
GOTRUE_SMTP_USER=x
GOTRUE_SMTP_PASS=x
GOTRUE_SMTP_ADMIN_EMAIL=nao-responda@resolveaqui.local
GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
GOTRUE_SMTP_MAX_FREQUENCY=1s
GOTRUE_PASSWORD_MIN_LENGTH=8
GOTRUE_LOG_LEVEL=warn
GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify
GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
ENV
(set -a; . ./auth.env; set +a; nohup ./auth > auth.log 2>&1 &)
sleep 4
if [ "${NEW:-0}" = 1 ]; then
  for f in "$HERE"/../../supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -h localhost -p 54322 -U postgres -f "$f"; done
fi
cat > pgrst.conf <<CONF
db-uri = "postgres://authenticator:authpass@localhost:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT"
server-port = 3001
server-host = "127.0.0.1"
CONF
nohup ./postgrest pgrst.conf > pgrst.log 2>&1 &
nohup node "$HERE/gateway.mjs" > gateway.log 2>&1 &
sleep 2
echo "Stack local pronta em http://localhost:54321. Chaves para .env.local:"
node "$HERE/make-keys.mjs" "$JWT"
