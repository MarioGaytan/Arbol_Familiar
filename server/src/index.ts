import 'dotenv/config';
import { buildApp } from './app.js';
import { migrate } from './migrate.js';
import { pool } from './db.js';
import { checkR2, LOCAL_UPLOAD_DIR, purgeOrphanPhotos, usingR2 } from './storage.js';

const app = await buildApp();

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
