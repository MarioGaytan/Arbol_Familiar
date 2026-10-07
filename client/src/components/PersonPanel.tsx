import { useEffect, useMemo, useRef, useState } from 'react';
import { Baby, Camera, Heart, Link2, Star, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useEditor } from '../store';
import { DATE_RE, formatDate, fullName, GENDER_LABEL, initials } from '../lib/format';
import { SWATCHES } from '../lib/themes';
import type { Gender, ParentKind, PartnerKind, Person } from '../types';
import { useDerived } from './FamilyCanvas';

const PARENT_KIND: Record<ParentKind, string> = {
  biological: 'Biológico',
  adoptive: 'Adoptivo',
  step: 'Padrastro/Madrastra',
  foster: 'De acogida',
};
const PARTNER_KIND: Record<PartnerKind, string> = {
  married: 'Casados',
  partner: 'Pareja',
  divorced: 'Divorciados',
  separated: 'Separados',
  widowed: 'Viudez',
};

/** Campo de texto que guarda al salir (blur) o con Enter. */
function Field(props: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
  placeholder?: string;
  multiline?: boolean;
  validate?: (v: string) => string | null;
  autoFocus?: boolean;
}) {
  const [v, setV] = useState(props.value ?? '');
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => setV(props.value ?? ''), [props.value]);
  useEffect(() => {
    if (props.autoFocus) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [props.autoFocus]);

  const commit = () => {
    const t = v.trim();
    const e = t && props.validate ? props.validate(t) : null;
    setErr(e);
    if (e) return;
    if (t !== (props.value ?? '')) props.onSave(t || null);
  };
  const Tag = props.multiline ? 'textarea' : 'input';
  return (
    <label className="field">
      <span>{props.label}</span>
      <Tag
        ref={ref}
        value={v}
        placeholder={props.placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => !props.multiline && e.key === 'Enter' && (e.target as HTMLElement).blur()}
        rows={props.multiline ? 3 : undefined}
        className={err ? 'invalid' : ''}
      />
      {err && <em className="err">{err}</em>}
    </label>
  );
}

const dateCheck = (v: string) => (DATE_RE.test(v) ? null : 'Formato: AAAA, AAAA-MM o AAAA-MM-DD');

function PersonChip({ p, onClick }: { p: Person; onClick: () => void }) {
  return (
    <button className="chip-person" onClick={onClick}>
      <span className="mini-avatar">{p.photoUrl ? <img src={p.photoUrl} alt="" /> : initials(p)}</span>
      {fullName(p)}
    </button>
  );
}

/** Ficha de sólo lectura (enlace público). */
function PersonDetails({ person, relation }: { person: Person; relation?: string }) {
  const s = useEditor();
  const id = person.id;
  const rel = (ids: string[], title: string) =>
    ids.length > 0 && (
      <>
        <h4>{title}</h4>
        <div className="chips">
          {ids.map((pid) => s.persons[pid] && <PersonChip key={pid} p={s.persons[pid]} onClick={() => s.focusPerson(pid)} />)}
        </div>
      </>
    );
  const parents = s.parentChild.filter((r) => r.childId === id).map((r) => r.parentId);
  const children = s.parentChild.filter((r) => r.parentId === id).map((r) => r.childId);
  const partners = s.partnerships
    .filter((p) => p.personA === id || p.personB === id)
    .map((p) => (p.personA === id ? p.personB : p.personA));
  return (
    <aside className="panel" key={id}>
      <header className="panel-head">
        <div className="panel-title">
          <strong>{fullName(person)}</strong>
          {relation && <span className="tag">{relation}</span>}
        </div>
        <button className="icon-btn" onClick={() => s.select(null)} title="Cerrar"><X size={18} /></button>
      </header>
      <div className="panel-body">
        <div className="details-photo">
          {person.photoUrl ? <img src={person.photoUrl} alt="" /> : <span>{initials(person)}</span>}
        </div>
        <dl className="details">
          {person.birthDate && (<><dt>Nacimiento</dt><dd>{formatDate(person.birthDate)}{person.birthPlace ? ` · ${person.birthPlace}` : ''}</dd></>)}
          {!person.birthDate && person.birthPlace && (<><dt>Lugar de nacimiento</dt><dd>{person.birthPlace}</dd></>)}
          {person.deathDate && (<><dt>Fallecimiento</dt><dd>{formatDate(person.deathDate)}</dd></>)}
        </dl>
        {rel(parents, 'Padres')}
        {rel(partners, 'Pareja')}
        {rel(children, 'Hijos')}
      </div>
    </aside>
  );
}

export function PersonPanel() {
  const s = useEditor();
  const { relations, rootId } = useDerived();
  const person = s.selectedId ? s.persons[s.selectedId] : null;
  const [linkKind, setLinkKind] = useState<'parent' | 'child' | 'partner'>('parent');
  const [linkTarget, setLinkTarget] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const others = useMemo(
    () =>
      Object.values(s.persons)
        .filter((p) => p.id !== person?.id)
        .sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [s.persons, person?.id],
  );

  if (!person) return null;
  if (s.readOnly) return <PersonDetails person={person} relation={relations.get(person.id)} />;
  const id = person.id;
  const save = (patch: Partial<Person>) => s.updatePerson(id, patch);
  const parents = s.parentChild.filter((r) => r.childId === id);
  const children = s.parentChild.filter((r) => r.parentId === id);
  const partners = s.partnerships.filter((p) => p.personA === id || p.personB === id);
  const autoFocus = s.justCreatedId === id;

  const doLink = () => {
    if (!linkTarget) return;
    if (linkKind === 'parent') s.linkParent(linkTarget, id);
    if (linkKind === 'child') s.linkParent(id, linkTarget);
    if (linkKind === 'partner') s.addPartnership(id, linkTarget);
    setLinkTarget('');
  };

  return (
    <aside className="panel" key={id}>
      <header className="panel-head">
        <div className="panel-title">
          <strong>{fullName(person)}</strong>
          {relations.get(id) && <span className="tag">{relations.get(id)}</span>}
        </div>
        <button className="icon-btn" onClick={() => s.select(null)} title="Cerrar">
          <X size={18} />
        </button>
      </header>

      <div className="panel-body">
        <div
          className="photo-edit"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f?.type.startsWith('image/')) s.set({ cropTarget: { personId: id, file: f } });
          }}
        >
          <div className="photo-big" onClick={() => fileRef.current?.click()}>
            {person.photoUrl ? <img src={person.photoUrl} alt="" /> : <span>{initials(person)}</span>}
            <div className="photo-overlay">
              <Camera size={20} />
            </div>
          </div>
          <div className="photo-actions">
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              <Camera size={14} /> {person.photoUrl ? 'Cambiar foto' : 'Subir foto'}
            </button>
            {person.photoUrl && (
              <button className="btn sm ghost" onClick={() => save({ photoUrl: null })}>
                Quitar
              </button>
            )}
            <small>o arrastra una imagen aquí o sobre la tarjeta</small>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) s.set({ cropTarget: { personId: id, file: f } });
              e.target.value = '';
            }}
          />
        </div>

        <div className="grid2">
          <Field label="Nombre(s)" value={person.firstName} onSave={(v) => v && save({ firstName: v })} autoFocus={autoFocus} />
          <Field label="Apellidos" value={person.lastName} onSave={(v) => save({ lastName: v })} />
        </div>

        <div className="field">
          <span>Género</span>
          <div className="segmented">
            {(['male', 'female', 'other', 'unknown'] as Gender[]).map((g) => (
              <button key={g} className={person.gender === g ? 'on' : ''} onClick={() => save({ gender: g })}>
                {GENDER_LABEL[g]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid2">
          <Field label="Nacimiento" value={person.birthDate} placeholder="1950 o 1950-03-12" validate={dateCheck} onSave={(v) => save({ birthDate: v })} />
          <Field label="Fallecimiento" value={person.deathDate} placeholder="vacío si vive" validate={dateCheck} onSave={(v) => save({ deathDate: v })} />
        </div>
        <Field label="Lugar de nacimiento" value={person.birthPlace} onSave={(v) => save({ birthPlace: v })} />
        <Field label="Notas" value={person.notes} multiline onSave={(v) => save({ notes: v })} />

        <div className="field">
          <span>Color de la tarjeta</span>
          <div className="swatches">
            <button className={`swatch none ${!person.color ? 'on' : ''}`} onClick={() => save({ color: null })} title="Del tema" />
            {SWATCHES.map((c) => (
              <button key={c} className={`swatch ${person.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => save({ color: c })} />
            ))}
            <input type="color" value={person.color ?? '#888888'} onChange={(e) => save({ color: e.target.value })} title="Color personalizado" />
          </div>
        </div>

        <section className="rels">
          <h4>Agregar familiar</h4>
          <div className="quick-grid">
            <button className="btn sm" onClick={() => s.createRelative('parent', id)}><Users size={14} /> Padre/Madre</button>
            <button className="btn sm" onClick={() => s.createRelative('partner', id)}><Heart size={14} /> Pareja</button>
            <button className="btn sm" onClick={() => s.createRelative('child', id)}><Baby size={14} /> Hijo/a</button>
            <button className="btn sm" onClick={() => s.createRelative('sibling', id)}><UserPlus size={14} /> Hermano/a</button>
          </div>

          <h4>Padres</h4>
          {!parents.length && <p className="empty">Sin padres registrados</p>}
          {parents.map((r) => (
            <div className="rel-row" key={r.parentId}>
              <PersonChip p={s.persons[r.parentId]} onClick={() => s.focusPerson(r.parentId)} />
              <select value={r.kind} onChange={(e) => s.setParentKind(r.parentId, id, e.target.value as ParentKind)}>
                {Object.entries(PARENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="icon-btn" title="Quitar vínculo" onClick={() => s.unlinkParent(r.parentId, id)}><X size={14} /></button>
            </div>
          ))}

          <h4>Parejas</h4>
          {!partners.length && <p className="empty">Sin pareja registrada</p>}
          {partners.map((p) => {
            const other = p.personA === id ? p.personB : p.personA;
            return (
              <div className="rel-row" key={p.id}>
                <PersonChip p={s.persons[other]} onClick={() => s.focusPerson(other)} />
                <select value={p.kind} onChange={(e) => s.setPartnershipKind(p.id, e.target.value as PartnerKind)}>
                  {Object.entries(PARTNER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className="icon-btn" title="Quitar vínculo" onClick={() => s.deletePartnership(p.id)}><X size={14} /></button>
              </div>
            );
          })}

          <h4>Hijos</h4>
          {!children.length && <p className="empty">Sin hijos registrados</p>}
          {children.map((r) => (
            <div className="rel-row" key={r.childId}>
              <PersonChip p={s.persons[r.childId]} onClick={() => s.focusPerson(r.childId)} />
              <span className="muted small">{PARENT_KIND[r.kind]}</span>
              <button className="icon-btn" title="Quitar vínculo" onClick={() => s.unlinkParent(id, r.childId)}><X size={14} /></button>
            </div>
          ))}

          <h4><Link2 size={14} /> Vincular con alguien existente</h4>
          <div className="link-row">
            <select value={linkKind} onChange={(e) => setLinkKind(e.target.value as typeof linkKind)}>
              <option value="parent">es su padre/madre</option>
              <option value="child">es su hijo/a</option>
              <option value="partner">es su pareja</option>
            </select>
            <select value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)}>
              <option value="">Elegir persona…</option>
              {others.map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
            </select>
            <button className="btn sm primary" disabled={!linkTarget} onClick={doLink}>Vincular</button>
          </div>
        </section>

        <div className="panel-footer">
          <button className="btn" disabled={rootId === id} onClick={() => s.updateTree({ rootPersonId: id })}>
            <Star size={15} /> {rootId === id ? 'Es la persona central' : 'Hacer persona central'}
          </button>
          <button
            className="btn danger"
            onClick={() => confirm(`¿Eliminar a ${fullName(person)} y sus vínculos?`) && s.deletePerson(id)}
          >
            <Trash2 size={15} /> Eliminar
          </button>
        </div>
      </div>
    </aside>
  );
}
