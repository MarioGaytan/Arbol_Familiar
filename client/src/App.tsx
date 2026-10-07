import { useEffect, useState } from 'react';
import { api } from './api';
import { useEditor } from './store';
import { TreeList } from './components/TreeList';
import { Editor, Toasts } from './components/Editor';
import { AuthScreen } from './components/AuthScreen';
import { AdminDashboard } from './components/AdminDashboard';
import { LegalPage, type LegalDoc } from './components/LegalPage';
import { AccountPage, ConsentModal, CookieBanner } from './components/AccountPage';

type Route = {
  tree: string | null;
  publicToken: string | null;
  invite: string | null;
  admin: boolean;
  account: boolean;
  legal: LegalDoc | null;
};
const LEGAL_DOCS: LegalDoc[] = ['privacidad', 'terminos', 'cookies'];
const currentRoute = (): Route => {
  const q = new URLSearchParams(location.search);
  const legal = q.get('legal') as LegalDoc | null;
  return {
    tree: q.get('arbol'),
    publicToken: q.get('ver'),
    invite: q.get('invitacion'),
    admin: q.has('admin'),
    account: q.has('cuenta'),
    legal: legal && LEGAL_DOCS.includes(legal) ? legal : null,
  };
};

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [checking, setChecking] = useState(true);
  const [consentRequired, setConsentRequired] = useState(false);
  const user = useEditor((s) => s.user);
  const setStore = useEditor((s) => s.set);
  const load = useEditor((s) => s.load);
  const loadPublic = useEditor((s) => s.loadPublic);
  const reset = useEditor((s) => s.reset);

  // ¿Hay sesión? (cookie httpOnly: sólo el servidor la puede leer)
  useEffect(() => {
    api
      .me()
      .then(({ user, consentRequired }) => {
        setStore({ user });
        setConsentRequired(consentRequired);
      })
      .catch(() => setStore({ user: null }))
      .finally(() => setChecking(false));
    const onExpired = () => setStore({ user: null });
    const onConsent = () => setConsentRequired(true);
    const onPop = () => setRoute(currentRoute());
    addEventListener('auth:expired', onExpired);
    addEventListener('consent:required', onConsent);
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('auth:expired', onExpired);
      removeEventListener('consent:required', onConsent);
      removeEventListener('popstate', onPop);
    };
  }, [setStore]);

  useEffect(() => {
    if (route.publicToken) loadPublic(route.publicToken);
    else if (route.tree && user && !consentRequired) load(route.tree);
    else reset();
  }, [route.publicToken, route.tree, user, consentRequired, load, loadPublic, reset]);

  const navigate = (search: string) => {
    history.pushState(null, '', search || location.pathname);
    setRoute(currentRoute());
  };
  const go = (id: string | null) => navigate(id ? `?arbol=${id}` : '');

  // Los enlaces a las páginas legales (<a href="?legal=…">) navegan dentro de la app sin recargar
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      const href = a?.getAttribute('href');
      if (!a || !href?.startsWith('?legal=') || a.target === '_blank' || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      navigate(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const logout = async () => {
    await api.logout().catch(() => undefined);
    reset();
    setStore({ user: null });
    setConsentRequired(false);
    go(null);
  };

  let page;
  if (route.legal) {
    page = <LegalPage doc={route.legal} onBack={() => (history.length > 1 ? history.back() : go(null))} />;
  } else if (route.publicToken) {
    // Enlace público: no requiere cuenta y es de sólo lectura
    page = <Editor key={route.publicToken} onBack={() => go(null)} />;
  } else if (checking) {
    page = <div className="loading">Cargando…</div>;
  } else if (!user) {
    // Al registrarse se limpia el token de la URL (ya no sirve: es de un solo uso)
    page = <AuthScreen inviteToken={route.invite} onRegistered={() => navigate('')} />;
  } else if (route.account) {
    page = <AccountPage onBack={() => go(null)} onDeleted={() => (setStore({ user: null }), go(null))} />;
  } else if (route.admin && user.isAdmin) {
    page = <AdminDashboard onBack={() => go(null)} />;
  } else if (route.tree) {
    page = <Editor key={route.tree} onBack={() => go(null)} />;
  } else {
    page = <TreeList onOpen={go} onLogout={logout} onAdmin={() => navigate('?admin')} onAccount={() => navigate('?cuenta')} />;
  }

  return (
    <>
      {page}
      {user && consentRequired && !route.legal && (
        <ConsentModal
          onAccepted={() => {
            setConsentRequired(false);
            if (route.tree) load(route.tree);
          }}
          onLogout={logout}
        />
      )}
      {!route.legal && <CookieBanner />}
      <Toasts />
    </>
  );
}
