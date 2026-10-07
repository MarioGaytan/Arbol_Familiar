import { useState, type FormEvent } from 'react';
import { Lock, TreePine } from 'lucide-react';
import { api } from '../api';
import { useEditor } from '../store';

export function AuthScreen() {
  const setStore = useEditor((s) => s.set);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = mode === 'login' ? await api.login(email, password) : await api.register(name, email, password);
      setStore({ user });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card card">
        <div className="logo"><TreePine size={28} /></div>
        <h1>Raíces</h1>
        <p className="muted">Tu árbol familiar, privado y fácil de compartir.</p>

        <div className="segmented auth-tabs">
          <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Iniciar sesión</button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Crear cuenta</button>
        </div>

        <form onSubmit={submit}>
          {mode === 'register' && (
            <label className="field">
              <span>Tu nombre</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </label>
          )}
          <label className="field">
            <span>Correo</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
            />
            {mode === 'register' && <em className="hint">Mínimo 8 caracteres</em>}
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn primary lg block" disabled={busy}>
            {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
        <p className="auth-foot">
          <Lock size={13} /> Tus árboles sólo los ven las personas que tú invites.
        </p>
      </div>
    </div>
  );
}
