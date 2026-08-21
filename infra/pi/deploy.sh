#!/usr/bin/env bash
#
# Despliega a la Raspberry Pi. Ejecutar desde la raiz del repo, en Git Bash.
#
#   ./infra/pi/deploy.sh
#
# Estrategia: se construye EN la Pi, no en Windows. Compilar arm64 desde x86_64
# obliga a emular o a cruzar binarios nativos, y el ahorro no compensa el riesgo
# de desplegar un bundle con dependencias de la plataforma equivocada.
#
# Se envia lo que git tiene registrado (git archive), asi que lo que se despliega
# es exactamente lo que esta commiteado. Nada de node_modules ni de .env locales.

set -euo pipefail

PI_HOST="${PI_HOST:-isaac@pi-isaac.local}"
PI_KEY="${PI_KEY:-${USERPROFILE:-$HOME}/.ssh/brio_pi}"
APP_DIR="${APP_DIR:-/home/isaac/vp}"
REF="${1:-HEAD}"

ssh_pi() { ssh -i "${PI_KEY}" "${PI_HOST}" "$@"; }

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Hay cambios sin commitear. Se despliega lo commiteado, asi que no coincidiria" >&2
  echo "con lo que ves en local. Commitea o usa: git stash" >&2
  exit 1
fi

log "Enviando ${REF} a ${PI_HOST}:${APP_DIR}"
ssh_pi "mkdir -p '${APP_DIR}'"
git archive --format=tar "${REF}" | ssh -i "${PI_KEY}" "${PI_HOST}" "tar -x -C '${APP_DIR}'"

log "Instalando y construyendo en la Pi"
ssh_pi bash -s <<REMOTE
set -euo pipefail
export PATH=/usr/local/bin:\$PATH
cd '${APP_DIR}'

pnpm install --frozen-lockfile

# NODE_OPTIONS acotado: la Pi tiene 4 GB y el build de Next es lo mas pesado
# que corre en esta maquina.
NODE_OPTIONS="--max-old-space-size=2048" pnpm build

# El bundle standalone no incluye los estaticos ni public: hay que copiarlos.
STANDALONE='${APP_DIR}/apps/web/.next/standalone/apps/web'
cp -r '${APP_DIR}/apps/web/.next/static' "\${STANDALONE}/.next/static"
if [ -d '${APP_DIR}/apps/web/public' ]; then
  cp -r '${APP_DIR}/apps/web/public' "\${STANDALONE}/public"
fi
REMOTE

log "Aplicando migraciones"
ssh_pi bash -s <<'REMOTE'
set -euo pipefail
export PATH=/usr/local/bin:$PATH
set -a; . /etc/vp/vp-web.env; set +a
cd /home/isaac/vp
pnpm db:migrate
REMOTE

log "Reiniciando servicio"
ssh_pi "sudo systemctl restart vp-web && sleep 2 && systemctl is-active vp-web"

log "Desplegado: http://pi-isaac.local:8090"
