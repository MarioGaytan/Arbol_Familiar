/**
 * Verifica la configuración de Cloudflare R2 paso a paso.
 *   npm run r2:check -w server -- https://tu-app.com
 * El argumento (opcional) es el dominio de la app, para comprobar la regla CORS.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const ok = (m: string) => console.log(`  ✔ ${m}`);
const fail = (m: string, hint?: string) => {
  console.log(`  ✘ ${m}`);
  if (hint) console.log(`    → ${hint}`);
  process.exitCode = 1;
};

console.log('\nRevisando Cloudflare R2…\n');
let storage: typeof import('../storage.js');
try {
  storage = await import('../storage.js');
} catch (e) {
  fail((e as Error).message);
  process.exit(1);
}
const { s3, usingR2, publicUrl } = storage;
if (!usingR2 || !s3) {
  fail('No hay variables R2_* configuradas', 'Cópialas en server/.env (local) o en Variables de Railway');
  process.exit(1);
}
ok('Variables R2_* completas');

const bucket = process.env.R2_BUCKET!;
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  ok(`Credenciales válidas y el bucket "${bucket}" existe`);
} catch (e) {
  fail(`No se pudo acceder al bucket "${bucket}": ${(e as Error).name}`, 'Revisa R2_ACCOUNT_ID, las llaves del token y que el token tenga permiso sobre ese bucket');
  process.exit(1);
}

const key = `healthcheck/${randomUUID()}.txt`;
const body = `prueba ${new Date().toISOString()}`;
try {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }));
  ok('Se puede escribir (el token tiene permiso de lectura y escritura)');
} catch (e) {
  fail(`No se pudo escribir: ${(e as Error).name}`, 'El token de API debe ser "Object Read & Write"');
  process.exit(1);
}

const url = publicUrl(key);
const appOrigin = process.argv[2]?.replace(/\/+$/, '');
try {
  const res = await fetch(url, { headers: appOrigin ? { Origin: appOrigin } : {} });
  const text = await res.text();
  if (res.ok && text === body) ok(`Lectura pública correcta: ${url}`);
  else fail(`La URL pública respondió ${res.status}`, 'Activa el acceso público del bucket (dominio propio o r2.dev) y revisa R2_PUBLIC_URL');
  if (appOrigin) {
    const allow = res.headers.get('access-control-allow-origin');
    if (allow === '*' || allow === appOrigin) ok(`CORS permite ${appOrigin} (las fotos saldrán en los PDF/PNG exportados)`);
    else fail(`CORS no permite ${appOrigin}`, 'Agrega la regla CORS del README en R2 → bucket → Settings → CORS Policy');
  } else {
    console.log('  · (Pasa el dominio de tu app como argumento para revisar también CORS)');
  }
} catch (e) {
  fail(`No se pudo leer la URL pública: ${(e as Error).message}`, 'Revisa R2_PUBLIC_URL');
}

await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
ok('Se puede borrar (la limpieza automática de fotos funcionará)');
console.log(process.exitCode ? '\nHay cosas por corregir.\n' : '\nTodo listo ✔\n');
process.exit();
