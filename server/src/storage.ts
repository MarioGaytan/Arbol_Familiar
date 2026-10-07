import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { pool } from './db.js';

export const LOCAL_UPLOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads');

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'] as const;
const env = process.env;
const present = R2_VARS.filter((v) => env[v]?.trim());

// Configuración a medias = error al arrancar (mejor que descubrirlo cuando alguien sube una foto)
if (present.length > 0 && present.length < R2_VARS.length) {
  const missing = R2_VARS.filter((v) => !present.includes(v));
  throw new Error(`Configuración de Cloudflare R2 incompleta. Faltan: ${missing.join(', ')}`);
}
if (env.R2_PUBLIC_URL && !/^https:\/\//.test(env.R2_PUBLIC_URL)) {
  throw new Error('R2_PUBLIC_URL debe empezar con https:// (p. ej. https://fotos.tudominio.com)');
}
if (env.NODE_ENV === 'production' && present.length === 0) {
  // En Railway el disco se borra en cada despliegue: sin R2 las fotos se perderían
  console.warn('⚠ Producción sin Cloudflare R2: las fotos se guardan en disco local y se PERDERÁN al redeplegar.');
}

export const usingR2 = present.length === R2_VARS.length;
const PUBLIC_BASE = (env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');

export const s3 = usingR2
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    })
  : null;

export const publicUrl = (key: string) => (usingR2 ? `${PUBLIC_BASE}/${key}` : `/uploads/${key}`);

/** Guarda un archivo (R2 en producción, disco en desarrollo), lo registra y devuelve su URL pública. */
export async function saveFile(key: string, body: Buffer, contentType: string, userId: string | null): Promise<string> {
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        // El nombre es único (UUID) y nunca cambia: el navegador/CDN puede guardarla un año
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } else {
    const filePath = path.join(LOCAL_UPLOAD_DIR, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
  }
  const url = publicUrl(key);
  await pool.query('INSERT INTO uploads(key, url, user_id, bytes) VALUES ($1, $2, $3, $4)', [key, url, userId, body.length]);
  return url;
}

export async function deleteFile(key: string) {
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  else await fs.rm(path.join(LOCAL_UPLOAD_DIR, key), { force: true });
}

/** Días que una foto sin usar se conserva antes de borrarse (permite deshacer cambios). */
export const ORPHAN_GRACE_DAYS = Number(env.PHOTO_GRACE_DAYS ?? 7);

/**
 * Borra las fotos que ninguna persona usa desde hace más de ORPHAN_GRACE_DAYS días:
 * fotos reemplazadas, de personas o árboles eliminados, o subidas que se cancelaron.
 */
export async function purgeOrphanPhotos(log: (msg: string) => void) {
  const { rows } = await pool.query<{ key: string }>(
    `SELECT u.key FROM uploads u
      WHERE u.created_at < now() - make_interval(days => $1)
        AND NOT EXISTS (SELECT 1 FROM persons p WHERE p.photo_url = u.url)
      LIMIT 500`,
    [ORPHAN_GRACE_DAYS],
  );
  let freed = 0;
  for (const { key } of rows) {
    // Revisa de nuevo justo antes de borrar, por si se volvió a usar (p. ej. con "deshacer")
    const stillUsed = await pool.query(
      'SELECT 1 FROM persons p JOIN uploads u ON u.url = p.photo_url WHERE u.key = $1 LIMIT 1',
      [key],
    );
    if (stillUsed.rowCount) continue;
    await deleteFile(key);
    await pool.query('DELETE FROM uploads WHERE key = $1', [key]);
    freed++;
  }
  if (freed) log(`fotos sin usar eliminadas: ${freed}`);
}

/** Comprueba que las credenciales y el bucket de R2 funcionan (se usa al arrancar). */
export async function checkR2() {
  if (!s3) return;
  await s3.send(new HeadBucketCommand({ Bucket: env.R2_BUCKET }));
}
