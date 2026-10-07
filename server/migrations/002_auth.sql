-- Cuentas de usuario, sesiones, permisos por árbol y enlace público de sólo lectura.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext NOT NULL CONSTRAINT users_email_uq UNIQUE
                 CONSTRAINT users_email_ck CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name           text NOT NULL CONSTRAINT users_name_ck CHECK (length(trim(name)) > 0),
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Se guarda sólo el hash SHA-256 del token: si se filtra la tabla, las sesiones no sirven
CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE tree_members (
  tree_id     uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CONSTRAINT tree_members_role_ck CHECK (role IN ('owner', 'editor')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tree_id, user_id)
);
-- Exactamente un dueño por árbol
CREATE UNIQUE INDEX tree_members_one_owner ON tree_members(tree_id) WHERE role = 'owner';
CREATE INDEX tree_members_user_idx ON tree_members(user_id);

-- Invitaciones a correos que todavía no tienen cuenta: se convierten en acceso al registrarse
CREATE TABLE tree_invites (
  tree_id     uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  email       citext NOT NULL CONSTRAINT tree_invites_email_ck CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role        text NOT NULL DEFAULT 'editor' CONSTRAINT tree_invites_role_ck CHECK (role IN ('editor')),
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tree_id, email)
);

-- Enlace público de sólo lectura (NULL = desactivado). Token aleatorio, imposible de adivinar.
ALTER TABLE trees ADD COLUMN public_token text CONSTRAINT trees_public_token_uq UNIQUE;
