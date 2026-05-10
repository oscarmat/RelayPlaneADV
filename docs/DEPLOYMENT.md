# Despliegue en VPS (Fork privado)

Guía de instalación y actualización de RelayPlaneADV en un servidor VPS usando un usuario no-root con npm global sin sudo.

## Requisitos previos

- VPS con Linux (Ubuntu/Debian recomendado)
- Node.js 18+ instalado
- Git instalado
- Usuario no-root creado (no usar root para el servicio en producción)

## Instalación inicial

### 1. Configurar npm global sin sudo

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
```

Añadir al final de `~/.bashrc`:

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
```

Aplicar:

```bash
source ~/.bashrc
```

### 2. Clonar el fork

```bash
cd ~
git clone <url-de-tu-fork> relayplane-adv
cd relayplane-adv
```

### 3. Instalar dependencias y compilar

```bash
npm install
npm run build
```

### 4. Enlazar globalmente (reemplaza el paquete de npm registry)

```bash
npm link
```

Esto crea un symlink en `~/.npm-global/bin/relayplane` que apunta a `~/relayplane-adv/dist/cli.js`. A partir de aquí, el comando `relayplane` ejecuta tu fork.

### 5. Verificar

```bash
relayplane --version
# Debería mostrar la versión de tu fork (1.9.34 o la que tengas)
```

### 6. Inicializar configuración

```bash
relayplane init
```

Esto crea `~/.relayplane/config.json` con la configuración base.

### 7. Configurar API keys

Añadir al final de `~/.bashrc`:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
# Añade las que necesites para tus proveedores
```

```bash
source ~/.bashrc
```

### 8. Arrancar

```bash
relayplane start
```

O para dejarlo en background con el servicio systemd (ver sección más abajo).

---

## Actualización del fork

Cuando hagas cambios en tu fork y quieras desplegar la nueva versión:

```bash
cd ~/relayplane-adv

# Traer los últimos cambios
git pull

# Reinstalar dependencias (por si hay nuevas)
npm install

# Recompilar
npm run build

# Reiniciar el servicio (si usas systemd)
systemctl --user restart relayplane-proxy

# O si no usas systemd, simplemente para y arranca de nuevo
```

No necesitas volver a hacer `npm link` — el symlink sigue apuntando al mismo directorio. Solo necesitas recompilar (`npm run build`) para que los cambios en `dist/` se reflejen.

---

## Servicio systemd

Hay dos opciones para instalar el servicio: el comando CLI integrado (requiere root) o la instalación manual a nivel de usuario (sin root).

### Opción A: Comando CLI (requiere root)

RelayPlane incluye un comando que instala el servicio a nivel de sistema:

```bash
sudo relayplane service install
```

Esto crea `/etc/systemd/system/relayplane-proxy.service` con auto-detección del binario, usuario, y API keys del entorno actual. También lee automáticamente archivos `.env` de `~/.relayplane/.env`, `~/.openclaw/.env` y `~/.env`.

```bash
sudo relayplane service status      # Ver estado
sudo relayplane service uninstall   # Desinstalar
```

> **Limitación:** Requiere sudo y crea un servicio de sistema. Si prefieres no usar root, usa la Opción B.

### Opción B: Servicio a nivel de usuario (sin root) — Recomendado para fork

Para un usuario no-root con nvm o npm-global, el servicio a nivel de usuario es más apropiado.

#### 1. Localizar el binario

```bash
which relayplane
# Ejemplo: /home/airouter/.npm-global/bin/relayplane
# O con nvm: /home/airouter/.nvm/versions/node/v22.x.x/bin/relayplane
```

#### 2. Crear el archivo de servicio

```bash
mkdir -p ~/.config/systemd/user/
nano ~/.config/systemd/user/relayplane.service
```

Contenido:

```ini
[Unit]
Description=RelayPlane Proxy
After=network.target

[Service]
Type=simple
ExecStart=/home/airouter/.npm-global/bin/relayplane start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=-%h/.relayplane/.env

[Install]
WantedBy=default.target
```

> **Importante:** Reemplaza la ruta de `ExecStart` con la salida de `which relayplane`. Si usas nvm, la ruta será algo como `/home/airouter/.nvm/versions/node/v22.x.x/bin/relayplane` — usa la versión exacta, no wildcards.

#### 3. Configurar API keys

Crea un archivo de entorno (más seguro que ponerlas en el .service):

```bash
cat > ~/.relayplane/.env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
EOF
chmod 600 ~/.relayplane/.env
```

#### 4. Habilitar persistencia sin sesión activa

```bash
# Permite que los servicios de usuario sigan corriendo sin sesión SSH abierta
loginctl enable-linger $(whoami)
```

#### 5. Activar el servicio

```bash
systemctl --user daemon-reload
systemctl --user enable --now relayplane.service
```

#### 6. Verificar

```bash
systemctl --user status relayplane.service
```

### Comandos útiles

```bash
systemctl --user status relayplane.service     # Ver estado
systemctl --user restart relayplane.service    # Reiniciar (tras actualización)
systemctl --user stop relayplane.service       # Parar
systemctl --user start relayplane.service      # Arrancar
journalctl --user -u relayplane.service -f     # Ver logs en tiempo real
journalctl --user -u relayplane.service --since "1 hour ago"  # Logs recientes
```

### Exponer a la red

Si necesitas que el proxy sea accesible desde fuera del VPS (por ejemplo, para que tus agentes se conecten remotamente), añade `--host 0.0.0.0` al `ExecStart`:

```ini
ExecStart=/home/airouter/.npm-global/bin/relayplane start --host 0.0.0.0
```

Recarga tras el cambio:

```bash
systemctl --user daemon-reload
systemctl --user restart relayplane.service
```

---

## Flujo completo de actualización (resumen)

```bash
cd ~/relayplane-adv
git pull
npm install
npm run build
systemctl --user restart relayplane.service
```

Eso es todo. El symlink de `npm link` hace que no necesites reinstalar nada — solo recompilar y reiniciar.

---

## Notas

- **Puerto por defecto:** 4100. Dashboard en `http://<ip-vps>:4100`.
- **`--host 0.0.0.0`** expone el proxy a la red. Sin este flag solo escucha en localhost.
- **Reverse proxy:** Si expones a internet, pon nginx o caddy delante con HTTPS.
- **Si antes tenías `@relayplane/proxy` de npm:** `npm link` lo reemplaza automáticamente. El symlink tiene prioridad sobre el paquete instalado desde registry.
- **Para volver al paquete oficial:** `npm unlink @relayplane/proxy && npm install -g @relayplane/proxy`.
