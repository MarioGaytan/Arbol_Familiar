import { useState, type FormEvent } from 'react';
import { ArrowLeft, Download, KeyRound, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { api } from '../api';
import { useEditor } from '../store';
import { LegalFooter } from './LegalPage';

/**
 * Mi cuenta: aquí viven los derechos ARCO dentro de la app (acceso/portabilidad, rectificación,
 * cancelación y revocación del consentimiento).
 */
export function AccountPage({ onBack, onDeleted }: { onBack: () => void; onDeleted: () => void }) {
  const user = useEditor((s) => s.user)!;
  const setStore = useEditor((s) => s.set);
  const toast = useEditor((s) => s.toast);
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [del, setDel] = useState({ open: false, password: '', confirm: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    run('name', async () => setStore({ user: (await api.updateMe(name.trim())).user }), 'Nombre actualizado');
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (await run('pw', () => api.changePassword(pw.current, pw.next), 'Contraseña actualizada. Se cerraron tus otras sesiones.')) setPw({ current: '', next: '' });
  };
  const deleteAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (await run('del', () => api.deleteMe(del.password), 'Tu cuenta y tus árboles fueron eliminados')) onDeleted();
  };

  return (
    <div className="account">
      <header className="admin-head">
        <button className="icon-btn" onClick={onBack} title="Volver"><ArrowLeft size={18} /></button>
        <div>
          <h1>Mi cuenta</h1>
          <p className="muted">{user.email}</p>
        </div>
      </header>

      <section className="card account-card">
        <h2><UserRound size={18} /> Datos de la cuenta</h2>
        <form className="inline-form" onSubmit={saveName}>
          <label className="field">
            <span>Nombre</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          </label>
          <button className="btn" disabled={busy === 'name' || !name.trim() || name.trim() === user.name}>Guardar</button>
        </form>
        <p className="hint">Para cambiar el correo de la cuenta escribe al contacto de privacidad indicado en el Aviso.</p>
      </section>

      <section className="card account-card">
        <h2><KeyRound size={18} /> Contraseña</h2>
        <form className="inline-form" onSubmit={changePw}>
          <label className="field">
            <span>Actual</span>
            <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
          </label>
          <label className="field">
            <span>Nueva (mín. 8)</span>
            <input type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
          </label>
          <button className="btn" disabled={busy === 'pw'}>Cambiar</button>
        </form>
      </section>

      <section className="card account-card">
        <h2><ShieldCheck size={18} /> Privacidad y tus derechos</h2>
        <p className="muted">
          Conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares puedes acceder,
          rectificar, cancelar u oponerte al tratamiento de tus datos (derechos ARCO).
        </p>
        <div className="rights">
          <div>
            <strong>Acceso y portabilidad</strong>
            <small>Descarga en un archivo todos tus datos y los de los árboles de los que eres dueño.</small>
            <button className="btn" disabled={busy === 'exp'} onClick={() => run('exp', api.exportMe, 'Descarga lista')}>
              <Download size={15} /> Descargar mis datos
            </button>
          </div>
          <div>
            <strong>Rectificación</strong>
            <small>Corrige tu nombre y contraseña arriba; los datos de cada persona, en su ficha del árbol.</small>
          </div>
          <div>
            <strong>Oposición y otras solicitudes</strong>
            <small>Escribe al contacto de privacidad indicado en el <a href="?legal=privacidad">Aviso de Privacidad</a>.</small>
          </div>
        </div>
      </section>

      <section className="card account-card danger-zone">
        <h2><Trash2 size={18} /> Eliminar mi cuenta</h2>
        <p className="muted">
          Cancela tu cuenta y revoca tu consentimiento. Se borran de inmediato tu cuenta, tus sesiones y <b>todos los árboles
          de los que eres dueño</b> (también para las personas con quienes los compartiste). Los árboles que otros
          compartieron contigo no se borran. Esta acción no se puede deshacer: descarga antes tus datos o exporta tus árboles.
        </p>
        {!del.open ? (
          <button className="btn danger" onClick={() => setDel({ ...del, open: true })}><Trash2 size={15} /> Quiero eliminar mi cuenta</button>
        ) : (
          <form className="inline-form" onSubmit={deleteAccount}>
            <label className="field">
              <span>Tu contraseña</span>
              <input type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} required />
            </label>
            <label className="field">
              <span>Escribe ELIMINAR para confirmar</span>
              <input value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} required />
            </label>
            <button className="btn danger-solid" disabled={busy === 'del' || del.confirm !== 'ELIMINAR' || !del.password}>Eliminar definitivamente</button>
          </form>
        )}
      </section>
      <LegalFooter />
    </div>
  );
}

/** Aviso que bloquea la app hasta aceptar la versión vigente del Aviso de Privacidad. */
export function ConsentModal({ onAccepted, onLogout }: { onAccepted: () => void; onLogout: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useEditor((s) => s.toast);
  return (
    <div className="modal-bg">
      <div className="modal consent-modal">
        <header><h3><ShieldCheck size={18} /> Actualizamos nuestro Aviso de Privacidad</h3></header>
        <div className="consent-body">
          <p>
            Para seguir usando Raíces necesitamos que leas y aceptes la versión vigente del{' '}
            <a href="?legal=privacidad" target="_blank" rel="noopener">Aviso de Privacidad</a> y de los{' '}
            <a href="?legal=terminos" target="_blank" rel="noopener">Términos y Condiciones</a>.
          </p>
          <label className="consent">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>He leído y acepto el Aviso de Privacidad y los Términos y Condiciones.</span>
          </label>
        </div>
        <footer>
          <button className="btn ghost" onClick={onLogout}>Cerrar sesión</button>
          <button
            className="btn primary"
            disabled={!checked || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.acceptLegal();
                onAccepted();
              } catch (e) {
                toast((e as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Aceptar y continuar
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Aviso informativo de cookies: sólo usamos una cookie esencial, así que basta con informar. */
export function CookieBanner() {
  const KEY = 'raices.cookies.ok';
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== '1';
    } catch {
      return true;
    }
  });
  if (!show) return null;
  return (
    <div className="cookie-banner" role="dialog" aria-label="Aviso de cookies">
      <span>
        Sólo usamos una <b>cookie esencial</b> para mantener tu sesión segura. Sin publicidad ni rastreo.{' '}
        <a href="?legal=cookies">Más información</a>
      </span>
      <button
        className="btn sm primary"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1');
          } catch {
            /* sin almacenamiento: se volverá a mostrar */
          }
          setShow(false);
        }}
      >
        Entendido
      </button>
    </div>
  );
}
