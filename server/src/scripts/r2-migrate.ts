/**
 * Sube a Cloudflare R2 las fotos guardadas en disco local (server/uploads) y actualiza
 * persons.photo_url en la base de datos indicada por DATABASE_URL.
 *   npm run r2:migrate -w server            → simulación: sólo muestra qué haría
 *   npm run r2:migrate -w server -- --apply → lo hace
 * Se puede repetir sin problema: lo que ya está migrado se salta.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { pool } from '../db.js';
import { LOCAL_UPLOAD_DIR, publicUrl, s3, usingR2 } from '../storage.js';

const apply = process.argv.includes('--apply');
if (!usingR2 || !s3) {
  console.error('Configura primero las variables R2_* (ver README) y ejecuta npm run r2:check -w server');
  process.exit(1);
}

const TYPES: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const dir = path.join(LOCAL_UPLOAD_DIR, 'photos');
const files = await fs.readdir(dir).catch(() => [] as string[]);
console.log(`${apply ? 'Migrando' : 'Simulación —'} ${files.length} archivo(s) de ${dir}\n`);

let moved = 0;
let skipped = 0;
for (const name of files) {
  const key = `photos/${name}`;
  const oldUrl = `/uploads/${key}`;
  const newUrl = publicUrl(key);
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM persons WHERE photo_url = $1', [oldUrl]);
  const users = rows[0].n;
  if (!users) {
    skipped++;
    continue; // ninguna persona la usa: no vale la pena subirla
  }
  console.log(`  ${name} → ${newUrl} (${users} persona(s))`);
  if (!apply) continue;
  const body = await fs.readFile(path.join(dir, name));
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  await pool.query('UPDATE persons SET photo_url = $1 WHERE photo_url = $2', [newUrl, oldUrl]);
  await pool.query(
    `INSERT INTO uploads(key, url, bytes) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET url = EXCLUDED.url`,
    [key, newUrl, body.length],
  );
  moved++;
}
console.log(`\n${apply ? `Migradas: ${moved}` : 'Nada se modificó (usa --apply para migrar)'} · sin uso (omitidas): ${skipped}`);
await pool.end();
