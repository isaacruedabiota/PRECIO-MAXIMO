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

Instala PostgreSQL 17 + PostGIS, Node 24 arm64, pnpm, crea el rol y la base
`vp`, escribe `/etc/vp/vp-web.env` y habilita `vp-web.service`.

**PostgreSQL va nativo desde apt, no en Docker.** En una maquina de 4 GB el
contenedor solo aporta consumo. Docker en local (Windows) sigue siendo la BD de
desarrollo; son dos bases distintas a proposito.

## Despliegue

```bash
./infra/pi/deploy.sh
```

Envia el arbol commiteado con `git archive`, instala, construye **en la Pi**
(arm64 nativo) y reinicia el servicio. Se niega a desplegar si hay cambios sin
commitear: lo que se despliega es exactamente lo que esta en git.

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
