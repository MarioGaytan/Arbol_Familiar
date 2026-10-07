import { useEffect } from 'react';
import { CLIENT_ID } from '../api';
import { useEditor } from '../store';

/**
 * Mantiene el árbol al día con los cambios de otros editores (Server-Sent Events).
 * El navegador reconecta solo si se cae la conexión; al reconectar se recarga por si hubo cambios mientras tanto.
 */
export function useLiveSync(treeId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!treeId || !enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api/trees/${treeId}/events?clientId=${CLIENT_ID}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let opened = false;
    const lastToast = new Map<string, number>();
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => useEditor.getState().refreshFromServer(), 350);
    };

    es.addEventListener('open', () => {
      if (opened) refresh(); // reconexión: pudo haber cambios perdidos
      opened = true;
    });
    es.addEventListener('change', (e) => {
      const { by } = JSON.parse((e as MessageEvent).data) as { by: string };
      refresh();
      // Avisar quién cambió algo, como mucho una vez cada 30 s por persona
      const now = Date.now();
      if (now - (lastToast.get(by) ?? 0) > 30_000) {
        lastToast.set(by, now);
        useEditor.getState().toast(`${by} está editando el árbol`);
      }
    });
    es.addEventListener('presence', (e) => {
      const me = useEditor.getState().user?.id;
      const users = JSON.parse((e as MessageEvent).data) as { id: string; name: string }[];
      useEditor.setState({ presence: users.filter((u) => u.id !== me) });
    });
    return () => {
      clearTimeout(timer);
      es.close();
      useEditor.setState({ presence: [] });
    };
  }, [treeId, enabled]);
}
