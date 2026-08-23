# Despliegue en la Raspberry Pi

Alojamiento actual del proyecto: una Raspberry Pi 4 Model B (arm64, 4 GB) en la
LAN de casa, con Debian 13 trixie.

## Estado de la maquina

| | |
|---|---|
| Host | `pi-isaac.local` (192.168.1.31) |
| Usuario | `isaac`, acceso por clave `~/.ssh/brio_pi` |
| Swap | 2 GB de zram, ya configurados |
| Puertos ya ocupados | 8080 (`footy-web`), 8129 (`fantasyhelper`), 22 (ssh) |
| Puerto de esta app | **8090** |

## Puesta en marcha (una sola vez)

```bash
scp -i ~/.ssh/brio_pi infra/pi/setup-pi.sh isaac@pi-isaac.local:/tmp/
ssh -i ~/.ssh/brio_pi isaac@pi-isaac.local 'sudo bash /tmp/setup-pi.sh'
```

Instala PostgreSQL 17 + PostGIS, Node 24 arm64 y pnpm, crea el rol `vp` y **dos
bases**, escribe `/etc/vp/vp-web.env` y habilita `vp-web.service`.

**PostgreSQL va nativo desde apt, no en Docker.** En una maquina de 4 GB el
contenedor solo aporta consumo.

**Las dos bases** (ADR-005): `vp` es la que sirve la aplicacion y `vp_dev` es
contra la que se desarrolla desde Windows por el tunel SSH (`pnpm db:tunnel`).
Mismo rol y misma contrasena; lo unico que cambia es el nombre al final del
`DATABASE_URL`. Sin esa separacion, una reingesta de prueba de MITMA o INE
sobrescribiria los datos que la Pi esta sirviendo.

```bash
# Que hay en cada una
sudo -u postgres psql -c "\l vp*"
```

## Despliegue

```bash
./infra/pi/deploy.sh
```

Envia el arbol commiteado con `git archive`, instala, construye **en la Pi**
(arm64 nativo), migra y reinicia el servicio. Se niega a desplegar si hay
cambios sin commitear: lo que se despliega es exactamente lo que esta en git.

### La primera vez, ademas: cargar los datos de mercado

El despliegue migra el esquema pero **no ingesta nada**, porque cada ingesta
llama a una fuente externa y eso es una decision, no un efecto secundario de
publicar. Sin datos, la aplicacion carga pero cualquier valoracion falla con
"no hay ningun precio de mercado", que es lo correcto: no se inventa un precio.

```bash
ssh -i ~/.ssh/brio_pi isaac@pi-isaac.local
export PATH=/usr/local/bin:$PATH
set -a; . /etc/vp/vp-web.env; set +a     # apunta a la base vp, no a vp_dev
cd /home/isaac/vp

pnpm ingest:municipios     # 8.142 municipios del INE
pnpm ingest:mitma          # valor tasado por municipio y provincia
pnpm ingest:ine            # IPV por CCAA
```

Se repiten cada trimestre, cuando MITMA y el INE publican. Son idempotentes:
reingestar el mismo trimestre actualiza las filas en lugar de duplicarlas.

## Operacion

```bash
ssh -i ~/.ssh/brio_pi isaac@pi-isaac.local

systemctl status vp-web
journalctl -u vp-web -f          # logs en vivo
sudo systemctl restart vp-web

psql "$(sudo grep DATABASE_URL /etc/vp/vp-web.env | cut -d= -f2-)"
```

## Notas

- **Sin exposicion a internet.** Solo LAN, sin TLS, sin redireccion de puertos en
  el router. Si algun dia se abre hacia fuera hacen falta HTTPS, autenticacion y
  el bloque legal completo (RGPD, aviso legal, politica de privacidad).
- **La config vive en el arbol desplegado**, no dentro del bundle: el servicio
  arranca con `VP_CONFIG_DIR=/home/isaac/vp/packages/config/data`. Un ajuste de
  tipos de ITP se aplica reiniciando el servicio, sin reconstruir.
- **Caddy** esta instalado y parado en la maquina. No lo usamos; ver
  `Caddyfile.example` si algun dia hace falta.
- El build de Next es lo mas pesado que corre en esta Pi. Va acotado a 2 GB de
  heap y tarda unos minutos.
