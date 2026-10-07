-- Protección de datos (LFPDPPP): consentimiento informado y versionado, y privacidad en enlaces públicos.

-- Versión del Aviso de Privacidad / Términos que aceptó cada usuario y cuándo (evidencia del consentimiento)
ALTER TABLE users ADD COLUMN legal_version text;
ALTER TABLE users ADD COLUMN legal_accepted_at timestamptz;
ALTER TABLE users ADD COLUMN adult_confirmed_at timestamptz;

-- Historial de aceptaciones (no se borra al actualizar: queda constancia de cada versión aceptada)
CREATE TABLE consent_log (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version      text NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_log_user_idx ON consent_log(user_id);

-- En el enlace público, ocultar fotos, fechas y lugares de personas vivas (por defecto: sí)
ALTER TABLE trees ADD COLUMN public_hide_living boolean NOT NULL DEFAULT true;
