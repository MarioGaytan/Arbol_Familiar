import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Globe, Link2Off, RefreshCw, UserPlus, X } from 'lucide-react';
import { api } from '../api';
import { useEditor } from '../store';
import type { SharingInfo } from '../types';

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const tree = useEditor((s) => s.tree)!;
  const me = useEditor((s) => s.user);
  const toast = useEditor((s) => s.toast);
  const [info, setInfo] = useState<SharingInfo | null>(null);
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<SharingInfo>, ok?: string) => {
    setBusy(true);
    try {
      setInfo(await fn());
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    api.getSharing(tree.id).then(setInfo).catch((e) => toast(e.message, 'error'));
  }, [tree.id, toast]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    await run(() => api.addMember(tree.id, addr));
    setEmail('');
  };

  const link = info?.publicToken ? `${location.origin}/?ver=${info.publicToken}` : null;
  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal share-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h3>Compartir “{tree.name}”</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="share-body">
          <section>
            <h4>Personas que pueden editar</h4>
            <form className="invite-row" onSubmit={invite}>
              <input type="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn primary" disabled={busy || !email.trim()}><UserPlus size={15} /> Invitar</button>
            </form>
            <p className="hint">
              Si aún no tiene cuenta, la invitación queda pendiente y obtendrá acceso al registrarse con ese correo.
              Avísale tú: la app no envía correos.
            </p>
            {!info && <p className="muted">Cargando…</p>}
            <ul className="member-list">
              {info?.members.map((m) => (
                <li key={m.userId}>
                  <span className="mini-avatar">{m.name[0]?.toUpperCase()}</span>
                  <span className="m-text">
                    <strong>{m.name}{m.userId === me?.id ? ' (tú)' : ''}</strong>
                    <small>{m.email}</small>
                  </span>
                  <span className={`role-badge ${m.role}`}>{m.role === 'owner' ? 'Dueño' : 'Editor'}</span>
                  {m.role !== 'owner' && (
                    <button className="icon-btn" title="Quitar acceso" onClick={() => run(() => api.removeMember(tree.id, m.userId))}>
                      <X size={15} />
                    </button>
                  )}
                </li>
              ))}
              {info?.invites.map((i) => (
                <li key={i.email} className="pending">
                  <span className="mini-avatar">@</span>
                  <span className="m-text">
                    <strong>{i.email}</strong>
                    <small>Pendiente: aún no se registra</small>
                  </span>
                  <span className="role-badge">Invitado</span>
                  <button className="icon-btn" title="Cancelar invitación" onClick={() => run(() => api.removeInvite(tree.id, i.email))}>
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="public-section">
            <h4><Globe size={14} /> Enlace público de sólo lectura</h4>
            <p className="hint">
              Cualquiera con el enlace puede <b>ver</b> el árbol (sin las notas privadas) y descargarlo, pero no editarlo.
            </p>
            {link ? (
              <>
                <div className="link-box">
                  <input readOnly value={link} onFocus={(e) => e.target.select()} />
                  <button className="btn" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar'}</button>
                </div>
                <div className="link-actions">
                  <button className="btn sm" disabled={busy} onClick={() => run(() => api.setPublicLink(tree.id, true), 'Enlace nuevo: el anterior ya no funciona')}>
                    <RefreshCw size={14} /> Generar otro enlace
                  </button>
                  <button className="btn sm danger" disabled={busy} onClick={() => run(() => api.setPublicLink(tree.id, false), 'Enlace público desactivado')}>
                    <Link2Off size={14} /> Desactivar
                  </button>
                </div>
              </>
            ) : (
              <button className="btn" disabled={busy || !info} onClick={() => run(() => api.setPublicLink(tree.id, true))}>
                <Globe size={15} /> Crear enlace público
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
