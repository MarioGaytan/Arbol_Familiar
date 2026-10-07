import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import { ZodError } from 'zod';
import { migrate } from './migrate.js';
import { pool } from './db.js';
import { registerRoutes } from './routes.js';
import { registerAccountRoutes } from './accountRoutes.js';
import { registerRealtime } from './realtime.js';
import { registerAdminRoutes } from './adminRoutes.js';
import { registerPrivacyRoutes } from './privacy.js';
import { checkR2, LOCAL_UPLOAD_DIR, purgeOrphanPhotos, usingR2 } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

/** Mensajes amigables para las restricciones de la base de datos. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  persons_dates_ck: 'La fecha de fallecimiento no puede ser anterior al nacimiento',
  parent_child_self_ck: 'Una persona no puede ser su propio padre/madre',
  parent_child_pkey: 'Esa relación padre/hijo ya existe',
  partnerships_pair_uq: 'Esas dos personas ya son pareja',
  persons_first_name_ck: 'El nombre es obligatorio',
  trees_name_ck: 'El árbol necesita un nombre',
  users_email_uq: 'Ya existe una cuenta con ese correo',
  users_email_ck: 'Correo inválido',
  user_themes_name_ck: 'El nombre del diseño debe tener entre 1 y 60 caracteres',
};

// trustProxy: detrás del proxy de Railway, para ver la IP real (límite de intentos de login)
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 2 * 1024 * 1024, trustProxy: true });

const PROD = process.env.NODE_ENV === 'production';

// HTTPS obligatorio en producción: Railway termina el TLS y avisa el protocolo original en X-Forwarded-Proto
// (FORCE_HTTPS=false sólo para probar la imagen de producción en local, sin certificado)
if (PROD && process.env.FORCE_HTTPS !== 'false') {
  app.addHook('onRequest', async (req, reply) => {
    if (req.protocol === 'http' && req.url !== '/api/health') {
      return reply.code(301).redirect(`https://${req.hostname}${req.url}`);
    }
  });
}

// Cabeceras de seguridad: HSTS, CSP, anti-clickjacking, sin sniffing de tipos, política de referer
const photoOrigin = process.env.R2_PUBLIC_URL ? new URL(process.env.R2_PUBLIC_URL).origin : null;
await app.register(helmet, {
  contentSecurityPolicy: PROD
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // estilos en línea de React Flow y del lienzo
          imgSrc: ["'self'", 'data:', 'blob:', ...(photoOrigin ? [photoOrigin] : [])],
          connectSrc: ["'self'", ...(photoOrigin ? [photoOrigin] : [])], // la exportación descarga las fotos
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [],
        },
      }
    : false, // en desarrollo Vite inyecta scripts en línea
  hsts: PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
});
app.addHook('onSend', async (_req, reply) => {
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
});

// La app y la API se sirven desde el mismo origen; CORS sólo para desarrollo
if (process.env.NODE_ENV !== 'production') await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(rateLimit, {
  global: false,
  errorResponseBuilder: () =>
    Object.assign(new Error("Demasiados intentos. Espera unos minutos e inténtalo de nuevo."), { statusCode: 429 }),
});
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

app.setErrorHandler((err: FastifyError & { constraint?: string }, req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: err.issues[0]?.message ?? 'Datos inválidos', details: err.issues });
  }
  const friendly = err.constraint ? CONSTRAINT_MESSAGES[err.constraint] : undefined;
  switch (err.code) {
    case '23505':
      return reply.code(409).send({ error: friendly ?? 'Ese registro ya existe' });
    case '23503':
      return reply.code(400).send({ error: 'Referencia inválida: la persona no existe o es de otro árbol' });
    case '23514':
      return reply.code(400).send({ error: friendly ?? 'Datos inválidos' });
    case 'P0001': // RAISE EXCEPTION en los triggers
      return reply.code(400).send({ error: err.message });
    case '22007':
    case '22008':
      return reply.code(400).send({ error: 'Fecha inválida' });
  }
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'Error interno del servidor' });
});

await registerAccountRoutes(app);
await registerRealtime(app);
await registerAdminRoutes(app);
await registerPrivacyRoutes(app);
await registerRoutes(app);

// Frontend compilado (producción): un solo servicio sirve API + app
if (fs.existsSync(CLIENT_DIST)) {
  await app.register(fastifyStatic, { root: CLIENT_DIST, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/uploads')) {
      return reply.code(404).send({ error: 'No encontrado' });
    }
    return reply.sendFile('index.html');
  });
}

if (!usingR2) {
  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
  await app.register(fastifyStatic, {
    root: LOCAL_UPLOAD_DIR,
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '365d',
    immutable: true,
  });
}

await migrate((m) => app.log.info(m));

// Limpieza de sesiones vencidas (cada hora)
const purgeSessions = () =>
  pool.query('DELETE FROM sessions WHERE expires_at < now()').catch((e) => app.log.warn(e, 'limpieza de sesiones'));
setInterval(purgeSessions, 3600_000).unref();
await purgeSessions();

// Fotos: verificar R2 al arrancar y borrar cada hora las que ya nadie usa
if (usingR2) {
  try {
    await checkR2();
    app.log.info('Cloudflare R2: conexión correcta');
  } catch (e) {
    app.log.error(e, 'Cloudflare R2: no se pudo acceder al bucket (revisa R2_* en las variables de entorno)');
    process.exit(1);
  }
}
const purgePhotos = () => purgeOrphanPhotos((m) => app.log.info(m)).catch((e) => app.log.warn(e, 'limpieza de fotos'));
setInterval(purgePhotos, 3600_000).unref();
void purgePhotos();
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
app.log.info(`Fotos en: ${usingR2 ? 'Cloudflare R2' : LOCAL_UPLOAD_DIR}`);
