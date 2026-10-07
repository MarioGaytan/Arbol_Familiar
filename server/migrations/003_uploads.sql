-- Registro de cada foto subida, para poder borrar las que ya nadie usa (en disco local o en Cloudflare R2).
-- No se borran al instante: deshacer un cambio de foto o un borrado debe poder recuperarla.
CREATE TABLE uploads (
  key         text PRIMARY KEY,           -- ruta dentro del almacenamiento, p. ej. photos/<uuid>.webp
  url         text NOT NULL UNIQUE,       -- URL pública que se guarda en persons.photo_url
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  bytes       integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX persons_photo_url_idx ON persons(photo_url) WHERE photo_url IS NOT NULL;
