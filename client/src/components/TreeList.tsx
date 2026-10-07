import { useEffect, useRef, useState } from 'react';
import { FileUp, LogOut, Plus, Trash2, TreePine, Users } from 'lucide-react';
import { api } from '../api';
import { useEditor } from '../store';
import type { Gender, Tree } from '../types';
import { parseGedcom } from '../lib/gedcom';

export function TreeList({ onOpen, onLogout }: { onOpen: (id: string) => void; onLogout: () => void }) {
  const toast = useEditor((s) => s.toast);
  const user = useEditor((s) => s.user);
  const [trees, setTrees] = useState<Tree[] | null>(null);
  const [name, setName] = useState('');
  const [me, setMe] = useState(user?.name.split(' ')[0] ?? '');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<Gender>('unknown');

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  /** GEDCOM: el formato estándar que exportan Ancestry, MyHeritage, FamilySearch, Gramps… */
  const importGedcom = async (file: File) => {
    setImporting(true);
    try {
      const parsed = parseGedcom(await file.arrayBuffer(), file.name);
      if (!parsed.persons.length) throw new Error('El archivo no contiene personas (¿es un .ged válido?)');
      const res = await api.importTree({
        name: parsed.name,
        rootPersonId: parsed.rootPersonId,
        persons: parsed.persons,
        parentChild: parsed.parentChild,
        partnerships: parsed.partnerships,
      });
      toast(`Importadas ${res.persons} personas${parsed.warnings.length ? ' · ' + parsed.warnings.join(' ') : ''}`);
      onOpen(res.id);
    } catch (e) {
      toast(`No se pudo importar: ${(e as Error).message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const refresh = () => api.listTrees().then(setTrees).catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    try {
      const t = await api.createTree(name.trim() || `Familia ${lastName || me}`.trim(), {
        firstName: me.trim(),
        lastName: lastName.trim() || null,
        gender,
      });
      onOpen(t.id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="home">
      <div className="user-bar">
        <span>Hola, <b>{user?.name}</b></span>
        <button className="btn sm ghost" onClick={onLogout}><LogOut size={14} /> Cerrar sesión</button>
      </div>
      <header className="home-hero">
        <div className="logo"><TreePine size={30} /></div>
        <h1>Raíces</h1>
        <p>Crea tu árbol familiar en un lienzo infinito: conecta, ordena y exporta para imprimir sin pelearte con el diseño.</p>
      </header>

      <section className="new-tree card">
        <h2>Nuevo árbol</h2>
        <p className="muted">Empieza por ti (o por quien será la persona central). Luego agregas padres, hijos y parejas desde su tarjeta.</p>
        <div className="grid2">
          <label className="field"><span>Tu nombre</span><input value={me} onChange={(e) => setMe(e.target.value)} placeholder="Ana" /></label>
          <label className="field"><span>Apellidos</span><input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="García López" /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>Nombre del árbol (opcional)</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Familia ${lastName.split(' ')[0] || '…'}`} /></label>
          <div className="field">
            <span>Género</span>
            <div className="segmented">
              {([['female', 'Mujer'], ['male', 'Hombre'], ['other', 'Otro']] as [Gender, string][]).map(([g, l]) => (
                <button key={g} className={gender === g ? 'on' : ''} onClick={() => setGender(g)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="new-actions">
          <button className="btn primary lg" disabled={!me.trim()} onClick={create}><Plus size={18} /> Crear árbol</button>
          <span className="muted">o</span>
          <button className="btn lg" disabled={importing} onClick={() => fileRef.current?.click()} title="Archivo .ged de Ancestry, MyHeritage, FamilySearch, Gramps…">
            <FileUp size={18} /> {importing ? 'Importando…' : 'Importar GEDCOM'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".ged,.gedcom,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importGedcom(f);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      <section className="my-trees">
        <h2>Mis árboles</h2>
        {trees === null && <p className="muted">Cargando…</p>}
        {trees?.length === 0 && <p className="muted">Aún no tienes árboles.</p>}
        <div className="tree-grid">
          {trees?.map((t) => (
            <div key={t.id} className="tree-card card" onClick={() => onOpen(t.id)}>
              <div className="tc-photo">{t.rootPhoto ? <img src={t.rootPhoto} alt="" /> : <TreePine size={28} />}</div>
              <div className="tc-text">
                <strong>{t.name}</strong>
                <small>{t.personCount} personas · {new Date(t.updatedAt!).toLocaleDateString('es')}</small>
                {t.role === 'editor' && (
                  <small className="shared-by"><Users size={12} /> Compartido por {t.ownerName}</small>
                )}
              </div>
              {t.role === 'owner' ? (
                <button
                  className="icon-btn"
                  title="Eliminar árbol"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`¿Eliminar el árbol "${t.name}" y todas sus personas? No se puede deshacer.`)) return;
                    await api.deleteTree(t.id).catch((err) => toast(err.message, 'error'));
                    refresh();
                  }}
                >
                  <Trash2 size={16} />
                </button>
              ) : (
                <button
                  className="icon-btn"
                  title="Dejar de tener acceso a este árbol"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`¿Salir del árbol "${t.name}"? Necesitarás otra invitación para volver.`)) return;
                    await api.removeMember(t.id, user!.id).catch((err) => toast(err.message, 'error'));
                    refresh();
                  }}
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
