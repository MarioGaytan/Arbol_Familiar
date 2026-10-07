import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Ban, Check, Copy, Link2, ShieldCheck, ShieldOff, UserCheck, Users, X } from 'lucide-react';
import { api, type LegalConfig } from '../api';
import { useEditor } from '../store';
import type { AdminStats, AdminUser, RegistrationInvite } from '../types';

const DURATIONS: [number, string][] = [
  [1, '1 hora'],
  [24, '24 horas'],
  [72, '3 días'],
  [168, '7 días'],
  [720, '30 días'],
];

const STATUS: Record<RegistrationInvite['status'], string> = {
  pending: 'Pendiente',
  used: 'Usada',
  expired: 'Caducada',
  revoked: 'Cancelada',
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function relative(d: string) {
  const ms = new Date(d).getTime() - Date.now();
  const h = Math.round(Math.abs(ms) / 3_600_000);
  const txt = h < 1 ? 'menos de 1 h' : h < 48 ? `${h} h` : `${Math.round(h / 24)} días`;
  return ms > 0 ? `caduca en ${txt}` : `hace ${txt}`;
}

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function AdminDashboard({ onBack }: { onBack: () => void }) {
  const me = useEditor((s) => s.user);
  const toast = useEditor((s) => s.toast);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [invites, setInvites] = useState<RegistrationInvite[] | null>(null);
  const [form, setForm] = useState({ email: '', note: '', hours: 72 });
  const [created, setCreated] = useState<{ link: string; email: string | null; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState('');
  const [legal, setLegal] = useState<LegalConfig | null>(null);
  useEffect(() => {
    api.legal().then(setLegal).catch(() => undefined);
  }, []);

  const refresh = useCallback(() => {
    api.admin.stats().then(setStats).catch((e) => toast(e.message, 'error'));
    api.admin.users().then(setUsers).catch((e) => toast(e.message, 'error'));
    api.admin.invites().then(setInvites).catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(refresh, [refresh]);

  const createInvite = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { invite, token } = await api.admin.createInvite({
        email: form.email.trim() || undefined,
        note: form.note.trim() || undefined,
        hours: form.hours,
      });
      setCreated({ link: `${location.origin}/?invitacion=${token}`, email: invite.email, expiresAt: invite.expiresAt });
      setCopied(false);
      setForm({ email: '', note: '', hours: form.hours });
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.link);
    setCopied(true);
  };

  const updateUser = async (u: AdminUser, patch: { status?: 'active' | 'blocked'; isAdmin?: boolean }, msg: string) => {
    if (patch.status === 'blocked' && !confirm(`¿Negar el acceso a ${u.name}? Se cerrarán sus sesiones al instante.`)) return;
    if (patch.isAdmin && !confirm(`¿Dar permisos de administrador a ${u.name}? Podrá invitar y bloquear usuarios.`)) return;
    try {
      await api.admin.updateUser(u.id, patch);
      toast(msg);
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const shownUsers = users?.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="admin">
      <header className="admin-head">
        <button className="icon-btn" onClick={onBack} title="Volver"><ArrowLeft size={18} /></button>
        <div>
          <h1>Administración</h1>
          <p className="muted">Usuarios, accesos e invitaciones de registro</p>
        </div>
      </header>

      {legal && !legal.configured && (
        <div className="legal-warning card">
          <strong>Completa los datos del responsable para el Aviso de Privacidad</strong>
          <span>
            La LFPDPPP exige identificar al responsable y su domicilio. Define <code>LEGAL_CONTROLLER_NAME</code>,{' '}
            <code>LEGAL_CONTROLLER_ADDRESS</code> y <code>LEGAL_CONTACT_EMAIL</code> en las variables de entorno.{' '}
            <a href="?legal=privacidad">Ver el aviso</a>
          </span>
        </div>
      )}
      {stats && (
        <section className="stat-grid">
          <div className="stat card"><span>Usuarios</span><strong>{stats.users}</strong>{stats.blocked > 0 && <small>{stats.blocked} bloqueado(s)</small>}</div>
          <div className="stat card"><span>Árboles</span><strong>{stats.trees}</strong></div>
          <div className="stat card"><span>Personas</span><strong>{stats.persons}</strong></div>
          <div className="stat card"><span>Fotos</span><strong>{stats.photos}</strong><small>{mb(stats.photoBytes)}</small></div>
          <div className="stat card"><span>Invitaciones activas</span><strong>{stats.pendingInvites}</strong></div>
        </section>
      )}

      <section className="card admin-card">
        <h2><Link2 size={18} /> Invitar a alguien</h2>
        <p className="muted">
          Sólo se puede crear una cuenta con un enlace de invitación. Cada enlace sirve <b>una vez</b> y caduca. Envíalo tú por
          WhatsApp o correo: la app no manda mensajes.
        </p>
        <form className="invite-form" onSubmit={createInvite}>
          <label className="field">
            <span>Correo (opcional)</span>
            <input type="email" placeholder="Si lo pones, sólo ese correo podrá usarlo" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="field">
            <span>Vigencia</span>
            <select value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}>
              {DURATIONS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Nota (opcional)</span>
            <input placeholder="p. ej. Tía Rosa" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button className="btn primary">Crear enlace</button>
        </form>

        {created && (
          <div className="created-link">
            <div>
              <strong>Enlace listo{created.email ? ` para ${created.email}` : ''}</strong>
              <small>Cópialo ahora: por seguridad no se vuelve a mostrar. Caduca el {fmt(created.expiresAt)}.</small>
            </div>
            <div className="link-box">
              <input readOnly value={created.link} onFocus={(e) => e.target.select()} />
              <button className="btn primary" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copiado' : 'Copiar'}</button>
            </div>
          </div>
        )}

        <h3>Historial de invitaciones</h3>
        {!invites?.length && <p className="empty">Aún no has creado invitaciones.</p>}
        {!!invites?.length && (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Para</th><th>Estado</th><th>Creada</th><th>Vence / usada</th><th /></tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className={i.status !== 'pending' ? 'dim' : ''}>
                    <td>
                      <strong>{i.email ?? 'Cualquier correo'}</strong>
                      {i.note && <small>{i.note}</small>}
                    </td>
                    <td><span className={`pill ${i.status}`}>{STATUS[i.status]}</span></td>
                    <td><small>{fmt(i.createdAt)}{i.createdBy ? ` · ${i.createdBy}` : ''}</small></td>
                    <td>
                      <small>
                        {i.status === 'used' ? `${fmt(i.usedAt)} · ${i.usedBy ?? ''}` : i.status === 'pending' ? relative(i.expiresAt) : fmt(i.revokedAt ?? i.expiresAt)}
                      </small>
                    </td>
                    <td>
                      {i.status === 'pending' && (
                        <button
                          className="icon-btn"
                          title="Cancelar invitación"
                          onClick={async () => {
                            await api.admin.revokeInvite(i.id).catch((e) => toast(e.message, 'error'));
                            refresh();
                          }}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card admin-card">
        <div className="admin-card-head">
          <h2><Users size={18} /> Usuarios</h2>
          <input className="filter" placeholder="Buscar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {!shownUsers && <p className="muted">Cargando…</p>}
        {shownUsers && (
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Persona</th><th>Acceso</th><th>Árboles</th><th>Último acceso</th><th>Alta</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {shownUsers.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className={u.status === 'blocked' ? 'dim' : ''}>
                      <td>
                        <strong>{u.name}{self ? ' (tú)' : ''}</strong>
                        <small>{u.email}</small>
                      </td>
                      <td>
                        <span className={`pill ${u.status === 'active' ? 'active' : 'blocked'}`}>{u.status === 'active' ? 'Permitido' : 'Bloqueado'}</span>
                        {u.isAdmin && <span className="pill admin">Admin</span>}
                      </td>
                      <td><small>{u.ownedTrees} propios · {u.sharedTrees} compartidos</small></td>
                      <td><small>{fmt(u.lastLoginAt)}</small></td>
                      <td><small>{fmt(u.createdAt)}{u.invitedBy ? ` · invitó ${u.invitedBy}` : ''}</small></td>
                      <td>
                        <div className="actions">
                        {self ? (
                          <small className="muted">—</small>
                        ) : (
                          <>
                            {u.status === 'active' ? (
                              <button className="btn sm danger" onClick={() => updateUser(u, { status: 'blocked' }, `${u.name} ya no puede entrar`)}>
                                <Ban size={14} /> Negar acceso
                              </button>
                            ) : (
                              <button className="btn sm" onClick={() => updateUser(u, { status: 'active' }, `${u.name} puede entrar de nuevo`)}>
                                <UserCheck size={14} /> Permitir
                              </button>
                            )}
                            {u.isAdmin ? (
                              <button className="btn sm ghost" onClick={() => updateUser(u, { isAdmin: false }, `${u.name} ya no es administrador`)}>
                                <ShieldOff size={14} /> Quitar admin
                              </button>
                            ) : (
                              <button className="btn sm ghost" onClick={() => updateUser(u, { isAdmin: true }, `${u.name} ahora es administrador`)}>
                                <ShieldCheck size={14} /> Hacer admin
                              </button>
                            )}
                          </>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Negar el acceso cierra sus sesiones al instante y no borra nada: sus árboles siguen ahí y puedes permitirle entrar de
          nuevo cuando quieras. No puedes cambiar tu propio acceso, y siempre debe quedar al menos un administrador.
        </p>
      </section>
    </div>
  );
}
