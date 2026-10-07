# Raíces · Árbol familiar

Editor de árboles familiares en un **lienzo infinito**: zoom y desplazamiento libres, tarjetas que se arrastran como en un plano, conexión de personas arrastrando entre puntos, parentescos calculados automáticamente y exportación lista para imprimir (hoja, cartel o mosaico de varias hojas).

## Arrancar en local

Requisitos: Node 20+ y Docker.

```bash
npm install
npm run db:up          # Postgres 16 en el puerto 5440
cp server/.env.example server/.env   # (ya existe si lo generó el asistente)
npm run dev            # API en :3001 + app en http://localhost:5173
```

## Cómo se usa

| Acción | Cómo |
|---|---|
| Agregar familiar | Selecciona una tarjeta → botones **Padre/Madre · Pareja · Hijo/a · Hermano/a** |
| Crear arrastrando | Arrastra desde el punto **inferior** a un espacio vacío = hijo; **superior** = padre; **lateral** = pareja |
| Conectar existentes | Arrastra de un punto de una tarjeta a otra (abajo→arriba = padre→hijo; lado→lado = pareja; si es ambiguo, pregunta) |
| Foto | Arrastra una imagen sobre la tarjeta, o "Subir foto" en el panel → recortar/zoom/girar |
| Mover | Arrastra tarjetas; `Shift` + arrastrar selecciona varias. Botón cuadrícula = alinear |
| Rastrear | Selecciona a alguien: se resalta el camino hasta la persona central. **Rastrear** atenúa a los demás |
| Ordenar | Reacomoda todo por generaciones, parejas juntas e hijos centrados |
| Forma del árbol | **Diseño → Forma**: *Generaciones* (de arriba a abajo), *Árbol* (crece hacia arriba desde un tronco con raíces, ramas que se afinan) o *Radial* (abanico de anillos desde los ancestros) |
| Deshacer / rehacer | Botones ↶ ↷ o `Ctrl+Z` / `Ctrl+Y` — cubre crear, borrar, editar, mover, vincular, ordenar y diseño |
| Borrar | `Supr` borra la(s) persona(s) seleccionada(s); clic en una línea + `Supr` (o "Quitar vínculo") borra ese vínculo. Siempre se puede deshacer |
| Exportar | PDF / PNG / SVG · Carta, Oficio, A4, Tabloide, A3–A0, pósters 18×24 y 24×36 in · mosaico en hojas Carta/A4 |

## Arquitectura

```
client/  React + Vite + TypeScript
  ├─ React Flow (@xyflow/react)  lienzo infinito, zoom, arrastre, minimapa
  ├─ lib/kinship.ts              parentescos derivados (abuelo, tío, primo segundo, cuñado, suegro…)
  ├─ lib/layout.ts               orden automático (dagre + pasadas por generación y parejas)
  ├─ lib/graph.ts                nodos "unión" para dibujar el estilo clásico en T
  ├─ lib/export.ts               html-to-image + jsPDF (tamaños de papel, DPI, mosaico)
  └─ lib/themes.ts               6 diseños: Clásico, Moderno, Bosque, Pergamino, Noche, Pastel
server/  Fastify + node-postgres + zod
  ├─ migrations/*.sql            esquema + reglas de integridad (se aplican al arrancar)
  └─ storage.ts                  fotos: disco local en dev, Cloudflare R2 en producción
```

### Modelo de datos (PostgreSQL)

Sólo se guardan relaciones **primarias**; todo lo demás se calcula:

- `persons` — datos de cada persona (fechas con precisión año/mes/día: "1950" es válido).
- `parent_child (parent_id, child_id, kind)` — biológico, adoptivo, padrastro, acogida.
- `partnerships (person_a, person_b, kind)` — casados, pareja, divorciados, separados, viudez.

Abuelos, tíos, primos, cuñados, suegros, etc. **no se almacenan**: se derivan, así nunca quedan inconsistentes.

La base de datos garantiza la integridad aunque la app tenga un bug:

- No hay ciclos (nadie puede ser su propio ancestro) — trigger con CTE recursivo.
- Máximo 2 padres biológicos (para más, usa adoptivo/padrastro).
- Nadie puede ser pareja de su padre/hijo, ni su propio padre.
- Las relaciones nunca cruzan árboles (FKs compuestas `(id, tree_id)`).
- Las parejas no se duplican (A,B)=(B,A) (orden canónico + UNIQUE).
- Fallecimiento ≥ nacimiento; color en formato `#RRGGBB`.
- Crear persona + sus vínculos ocurre en **una transacción**: si una regla falla, no se crea nada.

## Cuentas, permisos y privacidad

- **Registro obligatorio** para crear o editar árboles. Autenticación propia (sin servicios externos): los datos de usuarios viven en tu Postgres.
- Contraseñas con **scrypt** (`node:crypto`), sal aleatoria por usuario. El login tarda lo mismo aunque el correo no exista (no se pueden "adivinar" cuentas) y tiene **límite de 10 intentos / 15 min por IP**.
- **Sesión en cookie `HttpOnly; Secure; SameSite=Lax`** (30 días). En la base sólo se guarda el hash SHA-256 del token; cerrar sesión la invalida en el servidor. Las vencidas se limpian cada hora.
- **Roles por árbol** (`tree_members`): `owner` (uno por árbol, lo garantiza un índice único) y `editor`. El servidor revisa el permiso en **cada** ruta `/api/trees/:treeId/...`; sin acceso responde 404 (no revela que el árbol existe). Sólo el dueño borra el árbol y gestiona quién tiene acceso; un editor puede salirse.
- **Invitar por correo**: si la persona ya tiene cuenta, obtiene acceso al instante; si no, queda una invitación pendiente que se aplica sola al registrarse con ese correo. *La app no envía correos*: avísale tú.
- **Enlace público de sólo lectura** (`/?ver=<token>`): token aleatorio de 144 bits, se puede desactivar o regenerar (el anterior deja de funcionar). No incluye las **notas privadas**. Permite ver, rastrear y exportar; no editar.
- **Migración de datos previos**: los árboles creados antes de existir cuentas pasan al **primer usuario que se registre**.
- **Fotos**: se guardan con nombre aleatorio (UUID) en R2 público. Nadie puede listarlas ni adivinar su URL, pero quien tenga la URL exacta de una foto puede verla. Es el equilibrio habitual (igual que las fotos de WhatsApp Web/Google Photos compartidas): servirlas con control de acceso obligaría a pasar cada imagen por el servidor (más lento y con costo de tráfico).

## Colaboración en vivo

Cuando otro editor cambia algo, tu pantalla se actualiza sola (y ves sus iniciales arriba, "en línea").

- Cada pestaña abre un canal **SSE** (Server-Sent Events): una conexión HTTP que queda abierta y por la que el servidor avisa.
- Cada cambio exitoso hace `NOTIFY` en PostgreSQL; el servidor escucha con `LISTEN` y reenvía el aviso. Funciona aunque algún día corras varias copias del servidor.
- La pestaña que hizo el cambio no se recarga a sí misma (cada pestaña tiene un `X-Client-Id`). Mientras arrastras una tarjeta, los cambios ajenos esperan a que la sueltes.
- Si dos personas editan **el mismo campo** a la vez, gana el último en guardar.

## GEDCOM (importar / exportar)

- **Importar**: en el inicio, *Importar GEDCOM* (archivos `.ged` de Ancestry, MyHeritage, FamilySearch, Gramps…). Se lee en el navegador y se crea el árbol completo en una transacción. Fechas aproximadas (`ABT 1930`, `BEF 1900`) se guardan como año y el texto original va a las notas; relaciones que violan las reglas (ciclos, >2 padres biológicos) se corrigen o se omiten con aviso.
- **Exportar**: *Exportar → GEDCOM*. Formato 5.5.1 en UTF-8: nombres, sexo, fechas, lugares, notas, parejas (casados/divorciados), filiación adoptiva/de acogida y fotos como enlaces. Sirve también como **respaldo** legible por cualquier programa de genealogía.

## Fotos: ciclo de vida

1. Se recortan y comprimen en el navegador (WebP 600×600, ~50 KB) y se suben con nombre aleatorio (UUID).
2. Cada subida queda registrada en la tabla `uploads`.
3. **Limpieza automática** cada hora: se borran (del disco o de R2) las fotos que ninguna persona usa desde hace más de `PHOTO_GRACE_DAYS` días (7 por defecto): fotos reemplazadas, de personas o árboles eliminados. El margen existe para que *deshacer* pueda recuperar una foto.
4. Límite de 120 subidas por hora por IP.

## Despliegue: qué usar y de dónde sale cada cosa

| Necesitas | Servicio | Dónde se consigue | Costo aprox.* |
|---|---|---|---|
| Servidor (app + API) | **Railway** | railway.com → cuenta con GitHub | Plan Hobby ~5 USD/mes (incluye uso) |
| Base de datos | **PostgreSQL de Railway** | Dentro del mismo proyecto de Railway | Entra en el uso del plan para algo pequeño |
| Fotos | **Cloudflare R2** | dash.cloudflare.com → R2 | Gratis hasta 10 GB; sin cobro por descargas |
| Dominio (ej. `raicesfamilia.com`) | **Cloudflare Registrar** | dash.cloudflare.com → Domain Registration | Precio de costo (~10–12 USD/año un `.com`) |
| HTTPS | Railway + Cloudflare | Automático | Gratis |
| Repositorio | **GitHub** (privado) | github.com | Gratis |

\*Orientativo; revisa precios actuales.

**¿Por qué el dominio en Cloudflare?** Porque R2 necesita un dominio propio administrado en Cloudflare para servir las fotos en producción (`fotos.tudominio.com`); la URL `r2.dev` que da Cloudflare es sólo para pruebas y tiene límites. Tener el dominio y el DNS en Cloudflare deja todo en un lugar: `tudominio.com` → Railway y `fotos.tudominio.com` → R2.

### 1. GitHub
1. Crea un repositorio **privado** y sube el proyecto (`git push`). El `.gitignore` ya excluye `.env`, fotos, compilados y respaldos.
2. Antes del primer push revisa qué se subirá: `git add --dry-run .` (no debe aparecer ningún `.env` ni `server/uploads`).

### 2. Cloudflare: dominio
1. Crea cuenta en dash.cloudflare.com → *Domain Registration → Register Domains* y compra el dominio (o, si ya tienes uno en otro lado, *Add a site* y cambia los nameservers a los de Cloudflare).

### 3. Cloudflare: R2 (fotos)
1. En el panel: **R2 Object Storage**. La primera vez pide activar R2 (puede pedir un método de pago aunque uses sólo la capa gratuita).
2. **Create bucket** → nombre `arbol-fotos`, ubicación automática.
3. Bucket → **Settings → Custom Domains → Connect Domain** → `fotos.tudominio.com` (Cloudflare crea el DNS solo). Esa es tu `R2_PUBLIC_URL` = `https://fotos.tudominio.com`.
4. Bucket → **Settings → CORS Policy → Add** (necesario para que las fotos salgan en los PDF/PNG):
   ```json
   [{ "AllowedOrigins": ["https://tudominio.com"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 86400 }]
   ```
5. R2 → **Manage R2 API Tokens → Create API Token**: permiso **Object Read & Write**, sólo para el bucket `arbol-fotos`. Copia:
   - *Access Key ID* → `R2_ACCESS_KEY_ID`
   - *Secret Access Key* → `R2_SECRET_ACCESS_KEY` (**se muestra una sola vez**; guárdala en tu gestor de contraseñas, nunca en git)
   - El *Account ID* (aparece en la página de R2 y en la URL del endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`) → `R2_ACCOUNT_ID`
6. Prueba desde tu computadora poniendo esas variables en `server/.env`:
   ```bash
   npm run r2:check -w server -- https://tudominio.com
   ```
   Revisa credenciales, escritura, lectura pública, CORS y borrado.

### 4. Railway (servidor + base de datos)
1. railway.com → **New Project → Deploy from GitHub repo** → elige el repositorio. Detecta el `Dockerfile` y `railway.json`.
2. En el proyecto: **+ New → Database → PostgreSQL**.
3. Servicio de la app → **Variables**:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=arbol-fotos
   R2_PUBLIC_URL=https://fotos.tudominio.com
   ```
   (`NODE_ENV=production` ya viene en el Dockerfile: cookies `Secure`, sin CORS.)
4. **Settings → Networking → Custom Domain** → `tudominio.com`. Railway te da un registro CNAME; créalo en Cloudflare → DNS. (Si dejas la nube naranja activada, en Cloudflare → SSL/TLS usa modo **Full**.)
5. Al arrancar, el servidor aplica las migraciones y comprueba R2; si algo falla, lo dice en los *Logs* de Railway.
6. **Regístrate tú primero**: el primer usuario recibe los árboles que ya existieran.
7. Postgres → **Backups**: actívalos. Y exporta de vez en cuando un GEDCOM como respaldo propio.

### 5. (Opcional) Llevar tus datos locales a producción
```bash
# 1) Copiar la base local a Railway (usa la "Public Network URL" del Postgres de Railway)
docker compose exec -T db pg_dump -U arbol --no-owner --clean --if-exists arbol > respaldo.sql
psql "postgresql://...railway..." -f respaldo.sql

# 2) Subir las fotos locales a R2 y actualizar sus enlaces en esa base
#    (en server/.env: DATABASE_URL = la URL pública de Railway + las R2_*)
npm run r2:migrate -w server             # simulación: muestra qué haría
npm run r2:migrate -w server -- --apply  # lo hace
```
`respaldo.sql` contiene datos personales: el `.gitignore` ignora `respaldo*.sql`, `backup*.sql` y `dump*.sql`, pero lo más seguro es guardarlo fuera del proyecto o borrarlo al terminar.

## Próximos pasos sugeridos

- **Recuperar contraseña y verificar correo**: requiere enviar emails (p. ej. Resend, plan gratis ~3 000/mes). Hoy, si alguien olvida su contraseña, hay que resetearla a mano en la base.
- Opción de ocultar datos de **personas vivas** en el enlace público.
- Historial de deshacer persistente (hoy vive en la sesión del navegador; se pierde al recargar).
- Vista "ancestros de X" / "descendientes de X" para árboles muy grandes.
