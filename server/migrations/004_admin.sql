-- Administración: roles de sistema, bloqueo de cuentas, registro sólo por invitación y diseños propios.

ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'active'
  CONSTRAINT users_status_ck CHECK (status IN ('active', 'blocked'));
ALTER TABLE users ADD COLUMN last_login_at timestamptz;

-- Si ya hay usuarios, el más antiguo pasa a ser administrador
UPDATE users SET is_admin = true WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1);

-- Enlaces de registro: un solo uso, con caducidad. Sólo se guarda el hash del token.
CREATE TABLE registration_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  bytea NOT NULL CONSTRAINT registration_invites_token_uq UNIQUE,
  email       citext CONSTRAINT registration_invites_email_ck CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  note        text CONSTRAINT registration_invites_note_ck CHECK (note IS NULL OR length(note) <= 200),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  CONSTRAINT registration_invites_expiry_ck CHECK (expires_at > created_at)
);
CREATE INDEX registration_invites_created_idx ON registration_invites(created_at DESC);

-- Diseños guardados por cada usuario (al aplicarlos se copian al árbol, así el árbol no depende de ellos)
CREATE TABLE user_themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL CONSTRAINT user_themes_name_ck CHECK (length(trim(name)) BETWEEN 1 AND 60),
  theme       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_themes_user_idx ON user_themes(user_id);
CREATE TRIGGER user_themes_updated_at BEFORE UPDATE ON user_themes
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
