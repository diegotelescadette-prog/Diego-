#!/usr/bin/env bash
# Junta as migrações (em ordem) num único arquivo para colar no SQL Editor do Supabase.
# NÃO inclui dados de demonstração (supabase/demo fica de fora).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=supabase/producao/1-banco-completo.sql
{
  echo "-- Resolve Aqui: banco completo para produção (gerado por scripts/gerar-sql-producao.sh)."
  echo "-- Cole tudo no SQL Editor de um projeto Supabase NOVO e clique em Run. Sem dados de demonstração."
  echo "begin;"
  for f in supabase/migrations/*.sql; do
    echo; echo "-- ===== $(basename "$f") ====="; cat "$f"; echo
  done
  echo "commit;"
} > "$OUT"
echo "Gerado: $OUT ($(wc -c < "$OUT") bytes)"
