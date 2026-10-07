import { useEffect, useState } from 'react';
import { api } from './api';
import { useEditor } from './store';
import { TreeList } from './components/TreeList';
import { Editor, Toasts } from './components/Editor';
import { AuthScreen } from './components/AuthScreen';
import { AdminDashboard } from './components/AdminDashboard';

type Route = { tree: string | null; publicToken: string | null; invite: string | null; admin: boolean };
const currentRoute = (): Route => {
  const q = new URLSearchParams(location.search);
  return { tree: q.get('arbol'), publicToken: q.get('ver'), invite: q.get('invitacion'), admin: q.has('admin') };
};

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [checking, setChecking] = useState(true);
  const user = useEditor((s) => s.user);
  const setStore = useEditor((s) => s.set);
  const load = useEditor((s) => s.load);
  const loadPublic = useEditor((s) => s.loadPublic);
  const reset = useEditor((s) => s.reset);

  // ¿Hay sesión? (cookie httpOnly: sólo el servidor la puede leer)
  useEffect(() => {
    api
      .me()
      .then(({ user }) => setStore({ user }))
      .catch(() => setStore({ user: null }))
      .finally(() => setChecking(false));
    const onExpired = () => setStore({ user: null });
    addEventListener('auth:expired', onExpired);
    const onPop = () => setRoute(currentRoute());
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('auth:expired', onExpired);
      removeEventListener('popstate', onPop);
    };
  }, [setStore]);

  useEffect(() => {
    if (route.publicToken) loadPublic(route.publicToken);
    else if (route.tree && user) load(route.tree);
    else reset();
  }, [route.publicToken, route.tree, user, load, loadPublic, reset]);

  const navigate = (search: string) => {
    history.pushState(null, '', search || location.pathname);
    setRoute(currentRoute());
  };
  const go = (id: string | null) => navigate(id ? `?arbol=${id}` : '');

  const logout = async () => {
    await api.logout().catch(() => undefined);
    reset();
    setStore({ user: null });
    go(null);
  };

  let page;
  if (route.publicToken) {
    // Enlace público: no requiere cuenta y es de sólo lectura
    page = <Editor key={route.publicToken} onBack={() => go(null)} />;
  } else if (checking) {
    page = <div className="loading">Cargando…</div>;
  } else if (!user) {
    // Al registrarse se limpia el token de la URL (ya no sirve: es de un solo uso)
    page = <AuthScreen inviteToken={route.invite} onRegistered={() => navigate('')} />;
  } else if (route.admin && user.isAdmin) {
    page = <AdminDashboard onBack={() => go(null)} />;
  } else if (route.tree) {
    page = <Editor key={route.tree} onBack={() => go(null)} />;
  } else {
    page = <TreeList onOpen={go} onLogout={logout} onAdmin={() => navigate('?admin')} />;
  }

  return (
    <>
      {page}
      <Toasts />
    </>
  );
}
