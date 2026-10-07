import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Baby, CalendarDays, Camera, Check, Heart, ImageOff, Link2, MapPin, Palette, Star, StickyNote, Trash2,
  UserPlus, UserRound, Users, X,
} from 'lucide-react';
import { useEditor } from '../store';
import { ageText, DATE_RE, formatDate, fullName, GENDER_LABEL, initials, longDate } from '../lib/format';
import { SWATCHES } from '../lib/themes';
import type { Gender, ParentKind, PartnerKind, Person } from '../types';
import { useDerived } from './FamilyCanvas';
import { PanelTabs } from './PanelTabs';
import { Section } from './Section';

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

// ---------------------------------------------------------------- piezas reutilizables

/** Campo que guarda al salir (blur) o con Enter, y confirma con "Guardado". */
function Field(props: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
  placeholder?: string;
  multiline?: boolean;
  validate?: (v: string) => string | null;
  hint?: (v: string) => ReactNode;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  const [v, setV] = useState(props.value ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
    if (e || t === (props.value ?? '')) return;
    props.onSave(t || null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  const Tag = props.multiline ? 'textarea' : 'input';
  const valid = v.trim() && (!props.validate || !props.validate(v.trim()));
  return (
    <label className="field">
      <span className="field-label">
        {props.label}
        {saved && <i className="saved"><Check size={12} /> Guardado</i>}
      </span>
      <Tag
        ref={ref}
        value={v}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        onChange={(e) => {
          setV(e.target.value);
          if (err) setErr(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => !props.multiline && e.key === 'Enter' && (e.target as HTMLElement).blur()}
        rows={props.multiline ? 4 : undefined}
        className={err ? 'invalid' : ''}
      />
      {err ? <em className="err">{err}</em> : props.hint && valid ? <em className="field-hint">{props.hint(v.trim())}</em> : null}
    </label>
  );
}

const dateCheck = (v: string) => (DATE_RE.test(v) ? null : 'Usa el formato AAAA, AAAA-MM o AAAA-MM-DD');

function Avatar({ p, size = 28 }: { p: Person; size?: number }) {
  return (
    <span className="mini-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {p.photoUrl ? <img src={p.photoUrl} alt="" /> : initials(p)}
    </span>
  );
}

function PersonChip({ p, onClick }: { p: Person; onClick: () => void }) {
  return (
    <button className="chip-person" onClick={onClick} title={`Ir a ${fullName(p)}`}>
      <Avatar p={p} size={24} />
      <span>{fullName(p)}</span>
    </button>
  );
}

/** Cabecera con foto, nombre, parentesco y resumen de vida. */
function Hero({ person, relation, isRoot, editable }: { person: Person; relation?: string; isRoot: boolean; editable: boolean }) {
  const s = useEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f?: File | null) => f?.type.startsWith('image/') && s.set({ cropTarget: { personId: person.id, file: f } });
  const born = person.birthDate ? formatDate(person.birthDate) : null;
  const died = person.deathDate ? formatDate(person.deathDate) : null;
  const ageLabel = ageText(person);

  return (
    <div className="pp-hero" style={person.color ? ({ '--hero': person.color } as React.CSSProperties) : undefined}>
      <div
        className={`pp-photo ${editable ? 'editable' : ''} ${over ? 'over' : ''}`}
        onClick={() => editable && fileRef.current?.click()}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (editable) pick(e.dataTransfer.files?.[0]);
        }}
        title={editable ? 'Haz clic o arrastra una foto aquí' : undefined}
      >
        {person.photoUrl ? <img src={person.photoUrl} alt="" /> : <span>{initials(person)}</span>}
        {editable && (
          <div className="pp-photo-overlay">
            <Camera size={20} />
            <small>{person.photoUrl ? 'Cambiar' : 'Agregar foto'}</small>
          </div>
        )}
        {editable && person.photoUrl && (
          <button
            className="pp-photo-remove"
            title="Quitar foto"
            onClick={(e) => {
              e.stopPropagation();
              s.updatePerson(person.id, { photoUrl: null });
            }}
          >
            <ImageOff size={13} />
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      <div className="pp-id">
        <h3>{fullName(person)}</h3>
        <div className="pp-tags">
          {isRoot && <span className="tag root"><Star size={11} fill="currentColor" /> Persona central</span>}
          {relation && !isRoot && <span className="tag">{relation}</span>}
          {person.deathDate && <span className="tag muted">† Fallecido{person.gender === 'female' ? 'a' : ''}</span>}
        </div>
        <ul className="pp-life">
          {born && (
            <li>
              <CalendarDays size={13} /> {born}
              {died ? ` – ${died}` : ''}
              {ageLabel && <b> · {ageLabel}</b>}
            </li>
          )}
          {person.birthPlace && (
            <li>
              <MapPin size={13} /> {person.birthPlace}
            </li>
          )}
          {!born && !person.birthPlace && editable && <li className="muted">Agrega fechas y lugar abajo</li>}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ficha de sólo lectura

function PersonDetails({ person, relation }: { person: Person; relation?: string }) {
  const s = useEditor();
  const { rootId } = useDerived();
  const id = person.id;
  const rel = (ids: string[], title: string) =>
    ids.length > 0 && (
      <div className="pp-family-group">
        <h5>{title}</h5>
        <div className="chips">
          {ids.map((pid) => s.persons[pid] && <PersonChip key={pid} p={s.persons[pid]} onClick={() => s.focusPerson(pid)} />)}
        </div>
      </div>
    );
  const parents = s.parentChild.filter((r) => r.childId === id).map((r) => r.parentId);
  const children = s.parentChild.filter((r) => r.parentId === id).map((r) => r.childId);
  const partners = s.partnerships.filter((p) => p.personA === id || p.personB === id).map((p) => (p.personA === id ? p.personB : p.personA));
  return (
    <aside className="panel" key={id}>
      <PanelTabs />
      <Hero person={person} relation={relation} isRoot={rootId === id} editable={false} />
      <div className="panel-body">
        {rel(parents, 'Padres')}
        {rel(partners, 'Pareja')}
        {rel(children, 'Hijos')}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- ficha editable

export function PersonPanel() {
  const s = useEditor();
  const { relations, rootId } = useDerived();
  const person = s.selectedId ? s.persons[s.selectedId] : null;
  const [linkKind, setLinkKind] = useState<'parent' | 'child' | 'partner'>('parent');
  const [linkTarget, setLinkTarget] = useState('');

  const others = useMemo(
    () => Object.values(s.persons).filter((p) => p.id !== person?.id).sort((a, b) => fullName(a).localeCompare(fullName(b))),
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
  const familyCount = parents.length + children.length + partners.length;

  const doLink = () => {
    if (!linkTarget) return;
    if (linkKind === 'parent') s.linkParent(linkTarget, id);
    if (linkKind === 'child') s.linkParent(id, linkTarget);
    if (linkKind === 'partner') s.addPartnership(id, linkTarget);
    setLinkTarget('');
  };

  const dateHint = (v: string) => {
    const a = ageText({ birthDate: v, deathDate: person.deathDate });
    return `${longDate(v)}${a && !person.deathDate ? ` · ${a}` : ''}`;
  };
  const deathHint = (v: string) => {
    const a = ageText({ birthDate: person.birthDate, deathDate: v });
    return `${longDate(v)}${a ? ` · ${a}` : ''}`;
  };

  return (
    <aside className="panel" key={id}>
      <PanelTabs />
      <Hero person={person} relation={relations.get(id)} isRoot={rootId === id} editable />

      <div className="pp-quick">
        <span>Agregar</span>
        <button onClick={() => s.createRelative('parent', id)} title="Agregar padre o madre"><Users size={16} /> Padre/Madre</button>
        <button onClick={() => s.createRelative('partner', id)} title="Agregar pareja"><Heart size={16} /> Pareja</button>
        <button onClick={() => s.createRelative('child', id)} title="Agregar hijo o hija"><Baby size={16} /> Hijo/a</button>
        <button onClick={() => s.createRelative('sibling', id)} title="Agregar hermano o hermana"><UserPlus size={16} /> Hermano/a</button>
      </div>

      <div className="panel-body pp-body">
        <Section id="datos" icon={<UserRound size={15} />} title="Datos personales">
          <div className="grid2">
            <Field label="Nombre(s)" value={person.firstName} onSave={(v) => v && save({ firstName: v })} autoFocus={autoFocus} maxLength={120} />
            <Field label="Apellidos" value={person.lastName} onSave={(v) => save({ lastName: v })} maxLength={120} />
          </div>
          <div className="field">
            <span className="field-label">Género</span>
            <div className="segmented">
              {(['female', 'male', 'other', 'unknown'] as Gender[]).map((g) => (
                <button key={g} className={person.gender === g ? 'on' : ''} onClick={() => save({ gender: g })}>
                  {g === 'unknown' ? 'Sin dato' : GENDER_LABEL[g]}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section id="fechas" icon={<CalendarDays size={15} />} title="Fechas y lugar">
          <div className="grid2">
            <Field label="Nacimiento" value={person.birthDate} placeholder="1950-03-12" validate={dateCheck} hint={dateHint} onSave={(v) => save({ birthDate: v })} />
            <Field label="Fallecimiento" value={person.deathDate} placeholder="Vacío si vive" validate={dateCheck} hint={deathHint} onSave={(v) => save({ deathDate: v })} />
          </div>
          <p className="fine">Si no sabes el día exacto, basta con el año (1950) o año y mes (1950-03).</p>
          <Field label="Lugar de nacimiento" value={person.birthPlace} placeholder="Ciudad, estado o país" onSave={(v) => save({ birthPlace: v })} maxLength={200} />
        </Section>

        <Section id="notas" icon={<StickyNote size={15} />} title="Notas" badge={person.notes ? <span className="count-badge">•</span> : null} defaultOpen={false}>
          <Field label="Historia, oficio, anécdotas…" value={person.notes} multiline onSave={(v) => save({ notes: v })} maxLength={5000} />
          <p className="fine">
            Las notas son privadas: no aparecen en el enlace público. Evita anotar datos sensibles de personas vivas (salud,
            religión, origen étnico, preferencias…) sin su consentimiento expreso.
          </p>
        </Section>

        <Section id="familia" icon={<Users size={15} />} title="Familia" badge={<span className="count-badge">{familyCount}</span>}>
          <div className="pp-family-group">
            <h5>Padres</h5>
            {!parents.length && <p className="empty">Sin padres registrados</p>}
            {parents.map((r) => (
              <div className="rel-row" key={r.parentId}>
                <PersonChip p={s.persons[r.parentId]} onClick={() => s.focusPerson(r.parentId)} />
                <select value={r.kind} onChange={(e) => s.setParentKind(r.parentId, id, e.target.value as ParentKind)} title="Tipo de filiación">
                  {Object.entries(PARENT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button className="icon-btn" title="Quitar vínculo" onClick={() => s.unlinkParent(r.parentId, id)}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="pp-family-group">
            <h5>Parejas</h5>
            {!partners.length && <p className="empty">Sin pareja registrada</p>}
            {partners.map((p) => {
              const other = p.personA === id ? p.personB : p.personA;
              return (
                <div className="rel-row" key={p.id}>
                  <PersonChip p={s.persons[other]} onClick={() => s.focusPerson(other)} />
                  <select value={p.kind} onChange={(e) => s.setPartnershipKind(p.id, e.target.value as PartnerKind)} title="Estado de la relación">
                    {Object.entries(PARTNER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <button className="icon-btn" title="Quitar vínculo" onClick={() => s.deletePartnership(p.id)}><X size={14} /></button>
                </div>
              );
            })}
          </div>
          <div className="pp-family-group">
            <h5>Hijos</h5>
            {!children.length && <p className="empty">Sin hijos registrados</p>}
            {children.map((r) => (
              <div className="rel-row" key={r.childId}>
                <PersonChip p={s.persons[r.childId]} onClick={() => s.focusPerson(r.childId)} />
                {r.kind !== 'biological' && <span className="kind-badge">{PARENT_KIND[r.kind]}</span>}
                <button className="icon-btn" title="Quitar vínculo" onClick={() => s.unlinkParent(id, r.childId)}><X size={14} /></button>
              </div>
            ))}
          </div>
          <div className="pp-link">
            <h5><Link2 size={13} /> Vincular con alguien que ya está en el árbol</h5>
            <div className="link-row">
              <select value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)}>
                <option value="">Elegir persona…</option>
                {others.map((p) => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
              </select>
              <select value={linkKind} onChange={(e) => setLinkKind(e.target.value as typeof linkKind)}>
                <option value="parent">es su padre/madre</option>
                <option value="child">es su hijo/a</option>
                <option value="partner">es su pareja</option>
              </select>
              <button className="btn sm primary" disabled={!linkTarget} onClick={doLink}>Vincular</button>
            </div>
          </div>
        </Section>

        <Section id="color" icon={<Palette size={15} />} title="Color de la tarjeta" defaultOpen={false} badge={person.color ? <span className="dot-badge" style={{ background: person.color }} /> : null}>
          <div className="swatches">
            <button className={`swatch none ${!person.color ? 'on' : ''}`} onClick={() => save({ color: null })} title="Usar el color del diseño" />
            {SWATCHES.map((c) => (
              <button key={c} className={`swatch ${person.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => save({ color: c })} title={c} />
            ))}
            <label className="swatch custom" title="Elegir otro color">
              <input type="color" value={person.color ?? '#888888'} onChange={(e) => save({ color: e.target.value })} />
            </label>
          </div>
          <p className="fine">Útil para distinguir ramas de la familia. El primer círculo usa el color del diseño.</p>
        </Section>

        <div className="pp-actions">
          <button className="btn" disabled={rootId === id} onClick={() => s.updateTree({ rootPersonId: id })} title="Los parentescos se calculan respecto a esta persona">
            <Star size={15} /> {rootId === id ? 'Es la persona central' : 'Hacer persona central'}
          </button>
          <button className="btn danger" onClick={() => s.deletePerson(id)} title="Se puede deshacer con Ctrl+Z">
            <Trash2 size={15} /> Eliminar
          </button>
        </div>
      </div>
    </aside>
  );
}
