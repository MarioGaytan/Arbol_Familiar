import { useEffect, useState, type FormEvent } from 'react';
import { Lock, MailCheck, ShieldCheck, TreePine } from 'lucide-react';
import { api } from '../api';
import { useEditor } from '../store';

type Mode = 'login' | 'register' | 'setup';

/**
 * Acceso. El registro sólo existe con un enlace de invitación válido (?invitacion=TOKEN),
 * salvo en una instalación nueva, donde la primera persona crea la cuenta de administrador.
 */
export function AuthScreen({ inviteToken, onRegistered }: { inviteToken: string | null; onRegistered: () => void }) {
  const setStore = useEditor((s) => s.set);
  const [mode, setMode] = useState<Mode>('login');
  const [invite, setInvite] = useState<{ email: string | null; expiresAt: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (inviteToken) {
      api
        .checkInvite(inviteToken)
        .then((inv) => {
          setInvite(inv);
          setMode('register');
          if (inv.email) setEmail(inv.email);
        })
        .catch((e) => setInviteError((e as Error).message));
    } else {
      api.setupStatus().then((r) => r.needsSetup && setMode('setup')).catch(() => undefined);
    }
  }, [inviteToken]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(name, email, password, mode === 'register' ? inviteToken ?? undefined : undefined);
      setStore({ user });
      if (mode !== 'login') onRegistered();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const registering = mode !== 'login';
  return (
    <div className="auth">
      <div className="auth-card card">
        <div className="logo"><TreePine size={28} /></div>
        <h1>Raíces</h1>
        <p className="muted">Tu árbol familiar, privado y fácil de compartir.</p>

        {mode === 'setup' && (
          <div className="auth-note ok">
            <ShieldCheck size={16} /> Instalación nueva: crea la <b>cuenta de administrador</b>.
          </div>
        )}
        {mode === 'register' && invite && (
          <div className="auth-note ok">
            <MailCheck size={16} />
            <span>
              Te invitaron a Raíces. Este enlace sirve <b>una sola vez</b> y caduca el{' '}
              {new Date(invite.expiresAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}.
            </span>
          </div>
        )}
        {inviteError && <div className="auth-note bad">{inviteError} Pide uno nuevo al administrador.</div>}

        {mode === 'register' && (
          <div className="segmented auth-tabs">
            <button className="on">Crear cuenta</button>
            <button onClick={() => setMode('login')}>Ya tengo cuenta</button>
          </div>
        )}

        <form onSubmit={submit}>
          {registering && (
            <label className="field">
              <span>Tu nombre</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </label>
          )}
          <label className="field">
            <span>Correo</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              readOnly={mode === 'register' && !!invite?.email}
              required
            />
            {mode === 'register' && invite?.email && <em className="hint">La invitación es para este correo</em>}
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={registering ? 'new-password' : 'current-password'}
              minLength={registering ? 8 : undefined}
              required
            />
            {registering && <em className="hint">Mínimo 8 caracteres</em>}
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn primary lg block" disabled={busy}>
            {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : mode === 'setup' ? 'Crear cuenta de administrador' : 'Crear mi cuenta'}
          </button>
        </form>
        <p className="auth-foot">
          <Lock size={13} /> {mode === 'login' ? 'El registro es sólo por invitación.' : 'Tus árboles sólo los ven las personas que tú invites.'}
        </p>
      </div>
    </div>
  );
}
