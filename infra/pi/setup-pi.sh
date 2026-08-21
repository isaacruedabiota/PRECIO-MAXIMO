#!/usr/bin/env bash
#
# Prepara la Raspberry Pi para alojar la aplicacion. Idempotente: se puede
# volver a ejecutar sin romper nada.
#
# Uso (desde la Pi, como root):
#   sudo bash setup-pi.sh
#
# Que hace:
#   1. PostgreSQL + PostGIS desde apt (nativo, no Docker: en 4 GB de RAM el
#      contenedor solo aporta peso).
#   2. Node LTS arm64 desde el tarball oficial, en /usr/local.
#   3. pnpm via corepack.
#   4. Rol y base de datos 'vp', con contrasena generada al vuelo.
#   5. /etc/vp/vp-web.env con la cadena de conexion, 0640 y solo legible por
#      root y el usuario de la aplicacion.
#   6. Unidad systemd vp-web.service escuchando en el 8090.
#
# Que NO hace:
#   - No toca Caddy. Esta instalado pero parado, y otras cosas tuyas viven en
#     8080 y 8129. La app escucha directamente en el 8090.
#   - No abre nada al exterior. Solo LAN.

set -euo pipefail

APP_USER="${APP_USER:-isaac}"
APP_DIR="/home/${APP_USER}/vp"
ENV_DIR="/etc/vp"
ENV_FILE="${ENV_DIR}/vp-web.env"
APP_PORT="${APP_PORT:-8090}"
NODE_MAJOR="${NODE_MAJOR:-24}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  echo "Este script necesita root. Ejecuta: sudo bash setup-pi.sh" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
log "Paquetes del sistema"
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils postgresql postgresql-client

PG_VERSION="$(psql --version | grep -oE '[0-9]+' | head -1)"
log "PostgreSQL ${PG_VERSION} instalado; anadiendo PostGIS"
apt-get install -y -qq "postgresql-${PG_VERSION}-postgis-3" "postgresql-${PG_VERSION}-postgis-3-scripts"

systemctl enable --now postgresql

# ---------------------------------------------------------------------------
log "Node.js ${NODE_MAJOR} (arm64)"
# ---------------------------------------------------------------------------
NODE_ACTUAL="$(/usr/local/bin/node -v 2>/dev/null || echo none)"
if [[ "${NODE_ACTUAL}" == v${NODE_MAJOR}.* ]]; then
  echo "Ya instalado: ${NODE_ACTUAL}"
else
  NODE_VER="$(curl -fsSL https://nodejs.org/dist/index.json \
    | python3 -c "import json,sys; print(next(r['version'] for r in json.load(sys.stdin) if r['version'].startswith('v${NODE_MAJOR}.')))")"
  echo "Instalando Node ${NODE_VER}"

  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-arm64.tar.xz" -o "${TMP}/node.tar.xz"
  # Verificacion de integridad contra el SHASUMS oficial.
  curl -fsSL "https://nodejs.org/dist/${NODE_VER}/SHASUMS256.txt" -o "${TMP}/SHASUMS256.txt"
  (cd "${TMP}" && grep "node-${NODE_VER}-linux-arm64.tar.xz" SHASUMS256.txt | sed "s#node-${NODE_VER}-linux-arm64.tar.xz#node.tar.xz#" | sha256sum -c -)

  tar -xJf "${TMP}/node.tar.xz" -C /usr/local --strip-components=1 \
    --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
fi

/usr/local/bin/corepack enable pnpm
echo "node $(/usr/local/bin/node -v) / pnpm $(/usr/local/bin/pnpm -v)"

# ---------------------------------------------------------------------------
log "Base de datos"
# ---------------------------------------------------------------------------
mkdir -p "${ENV_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  echo "${ENV_FILE} ya existe: se conserva la contrasena actual."
  # shellcheck disable=SC1090
  DB_PASS="$(grep -oP '(?<=postgres://vp:)[^@]+' "${ENV_FILE}")"
else
  DB_PASS="$(openssl rand -hex 24)"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vp') THEN
    CREATE ROLE vp LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE vp PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='vp'" | grep -q 1; then
  sudo -u postgres createdb -O vp vp
fi

sudo -u postgres psql -d vp -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres psql -d vp -tAc "SELECT postgis_version();"

# ---------------------------------------------------------------------------
log "Configuracion de entorno"
# ---------------------------------------------------------------------------
cat > "${ENV_FILE}" <<ENV
# Generado por infra/pi/setup-pi.sh. No versionar.
DATABASE_URL=postgres://vp:${DB_PASS}@localhost:5432/vp
NODE_ENV=production
PORT=${APP_PORT}
HOSTNAME=0.0.0.0
# El bundle standalone de Next no conserva la ruta relativa a packages/config,
# asi que el directorio de config se indica de forma explicita.
VP_CONFIG_DIR=${APP_DIR}/packages/config/data
ENV

chown root:"${APP_USER}" "${ENV_FILE}"
chmod 0640 "${ENV_FILE}"

install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}"

# ---------------------------------------------------------------------------
log "Servicio systemd"
# ---------------------------------------------------------------------------
cat > /etc/systemd/system/vp-web.service <<UNIT
[Unit]
Description=VP - calculadora de precio maximo de compra de vivienda
Documentation=file://${APP_DIR}/CLAUDE.md
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/apps/web/.next/standalone/apps/web
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/bin/node server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=vp-web

# Endurecimiento basico. La app solo lee su propio arbol y habla con Postgres
# por localhost.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${APP_DIR}/apps/web/.next/cache
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable vp-web.service

log "Listo"
cat <<FIN
PostgreSQL ${PG_VERSION} + PostGIS activos, base 'vp' creada.
Node $(/usr/local/bin/node -v), pnpm $(/usr/local/bin/pnpm -v).
Entorno en ${ENV_FILE} (0640 root:${APP_USER}).
Servicio vp-web habilitado, escuchara en el ${APP_PORT}.

El servicio NO se ha arrancado todavia: no hay build. Despliega con:
  ./infra/pi/deploy.sh
FIN
