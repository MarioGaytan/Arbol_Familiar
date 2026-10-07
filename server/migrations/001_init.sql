-- Esquema base del árbol familiar.
-- Principio: sólo se guardan relaciones PRIMARIAS (padre→hijo y parejas).
-- Abuelos, tíos, primos, cuñados, etc. se DERIVAN en la app, así nunca se desincronizan.

CREATE TABLE trees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CONSTRAINT trees_name_ck CHECK (length(trim(name)) > 0),
  root_person_id  uuid,
  theme           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id          uuid NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  first_name       text NOT NULL CONSTRAINT persons_first_name_ck CHECK (length(trim(first_name)) > 0),
  last_name        text,
  gender           text NOT NULL DEFAULT 'unknown'
                   CONSTRAINT persons_gender_ck CHECK (gender IN ('male','female','other','unknown')),
  birth_date       date,
  birth_precision  text CONSTRAINT persons_birth_precision_ck CHECK (birth_precision IN ('day','month','year')),
  death_date       date,
  death_precision  text CONSTRAINT persons_death_precision_ck CHECK (death_precision IN ('day','month','year')),
  birth_place      text,
  notes            text,
  photo_url        text,
  color            text CONSTRAINT persons_color_ck CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  pos_x            double precision,
  pos_y            double precision,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT persons_dates_ck CHECK (death_date IS NULL OR birth_date IS NULL OR death_date >= birth_date),
  -- Permite FKs compuestas (id, tree_id) para garantizar que las relaciones no crucen árboles
  CONSTRAINT persons_id_tree_uq UNIQUE (id, tree_id)
);
CREATE INDEX persons_tree_idx ON persons(tree_id);

-- La persona central debe pertenecer al mismo árbol. Si se borra, sólo se anula root_person_id (PG15+).
ALTER TABLE trees
  ADD CONSTRAINT trees_root_fk FOREIGN KEY (root_person_id, id)
  REFERENCES persons(id, tree_id) ON DELETE SET NULL (root_person_id);

CREATE TABLE parent_child (
  tree_id     uuid NOT NULL,
  parent_id   uuid NOT NULL,
  child_id    uuid NOT NULL,
  kind        text NOT NULL DEFAULT 'biological'
              CONSTRAINT parent_child_kind_ck CHECK (kind IN ('biological','adoptive','step','foster')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, child_id),
  CONSTRAINT parent_child_self_ck CHECK (parent_id <> child_id),
  FOREIGN KEY (parent_id, tree_id) REFERENCES persons(id, tree_id) ON DELETE CASCADE,
  FOREIGN KEY (child_id,  tree_id) REFERENCES persons(id, tree_id) ON DELETE CASCADE
);
CREATE INDEX parent_child_child_idx ON parent_child(child_id);
CREATE INDEX parent_child_tree_idx ON parent_child(tree_id);

CREATE TABLE partnerships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id     uuid NOT NULL,
  person_a    uuid NOT NULL,
  person_b    uuid NOT NULL,
  kind        text NOT NULL DEFAULT 'married'
              CONSTRAINT partnerships_kind_ck CHECK (kind IN ('married','partner','divorced','separated','widowed')),
  start_date  date,
  end_date    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Orden canónico: evita duplicados (A,B) y (B,A)
  CONSTRAINT partnerships_order_ck CHECK (person_a < person_b),
  CONSTRAINT partnerships_pair_uq UNIQUE (person_a, person_b),
  FOREIGN KEY (person_a, tree_id) REFERENCES persons(id, tree_id) ON DELETE CASCADE,
  FOREIGN KEY (person_b, tree_id) REFERENCES persons(id, tree_id) ON DELETE CASCADE
);
CREATE INDEX partnerships_tree_idx ON partnerships(tree_id);
CREATE INDEX partnerships_b_idx ON partnerships(person_b);

-- ---------- Reglas de integridad genealógica ----------

CREATE FUNCTION trg_parent_child_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bio_count int;
BEGIN
  -- 1) Sin ciclos: el hijo no puede ser ancestro del padre
  IF EXISTS (
    WITH RECURSIVE ancestors(id) AS (
      SELECT pc.parent_id FROM parent_child pc WHERE pc.child_id = NEW.parent_id
      UNION
      SELECT pc.parent_id FROM parent_child pc JOIN ancestors a ON pc.child_id = a.id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.child_id
  ) THEN
    RAISE EXCEPTION 'Relación imposible: crearía un ciclo (alguien sería su propio ancestro)';
  END IF;

  -- 2) Máximo dos padres biológicos
  IF NEW.kind = 'biological' THEN
    SELECT count(*) INTO bio_count FROM parent_child
     WHERE child_id = NEW.child_id AND kind = 'biological' AND parent_id <> NEW.parent_id;
    IF bio_count >= 2 THEN
      RAISE EXCEPTION 'Esta persona ya tiene dos padres biológicos. Usa el tipo "adoptivo" o "padrastro/madrastra".';
    END IF;
  END IF;

  -- 3) No se puede ser padre/madre de la propia pareja
  IF EXISTS (SELECT 1 FROM partnerships
              WHERE person_a = LEAST(NEW.parent_id, NEW.child_id)
                AND person_b = GREATEST(NEW.parent_id, NEW.child_id)) THEN
    RAISE EXCEPTION 'No se puede ser padre/madre de la propia pareja';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER parent_child_check
  BEFORE INSERT OR UPDATE ON parent_child
  FOR EACH ROW EXECUTE FUNCTION trg_parent_child_check();

CREATE FUNCTION trg_partnership_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM parent_child
              WHERE (parent_id = NEW.person_a AND child_id = NEW.person_b)
                 OR (parent_id = NEW.person_b AND child_id = NEW.person_a)) THEN
    RAISE EXCEPTION 'Un padre/madre y su hijo/a no pueden ser pareja';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER partnership_check
  BEFORE INSERT OR UPDATE ON partnerships
  FOR EACH ROW EXECUTE FUNCTION trg_partnership_check();

CREATE FUNCTION trg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trees_updated_at BEFORE UPDATE ON trees
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER persons_updated_at BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
