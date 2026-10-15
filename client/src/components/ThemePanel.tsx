import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Brush, Check, Eye, LayoutTemplate, Pencil, RotateCcw, Save, Sparkles, Trash2, Type, Network } from 'lucide-react';
import { api } from '../api';
import { useEditor } from '../store';
import { COLOR_GROUPS, contrast, FONTS, resolveTheme, snapshotStyle, STYLE_KEYS, THEMES, type ColorKey } from '../lib/themes';
import type { EdgeStyle, Person, LayoutMode, Pattern, PhotoShape, TreeSettings, UserTheme } from '../types';
import { initials, lifespan } from '../lib/format';
import { PanelTabs } from './PanelTabs';
import { Section } from './Section';

const LAYOUT_MODES: [LayoutMode, string, string][] = [
  ['generations', 'Generaciones', 'De arriba hacia abajo'],
  ['tree', 'Árbol', 'Crece hacia arriba desde un tronco'],
  ['radial', 'Radial', 'Anillos · ideal para familias pequeñas'],
];

function ModeIcon({ mode }: { mode: LayoutMode }) {
  const c = 'currentColor';
  if (mode === 'tree')
    return (
      <svg viewBox="0 0 48 40" width="44" height="36">
        <path d="M22 39 C22 30 23 26 24 22 C25 26 26 30 26 39 Z" fill={c} />
        <path d="M24 23 C20 18 12 18 10 12 M24 23 C28 18 36 18 38 12 M24 22 L24 8" stroke={c} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {[[10, 9], [24, 6], [38, 9]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="4.5" fill={c} opacity=".55" />)}
      </svg>
    );
  if (mode === 'radial')
    return (
      <svg viewBox="0 0 48 40" width="44" height="36">
        <circle cx="24" cy="20" r="9" stroke={c} fill="none" strokeDasharray="2 3" opacity=".6" />
        <circle cx="24" cy="20" r="17" stroke={c} fill="none" strokeDasharray="2 3" opacity=".6" />
        <circle cx="24" cy="20" r="4" fill={c} />
        {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={24 + 17 * Math.sin((a * Math.PI) / 180)} cy={20 - 17 * Math.cos((a * Math.PI) / 180)} r="3.5" fill={c} opacity=".55" />)}
      </svg>
    );
  return (
    <svg viewBox="0 0 48 40" width="44" height="36">
      <rect x="18" y="3" width="12" height="9" rx="2" fill={c} />
      <path d="M24 12 V18 M10 18 H38 M10 18 V24 M24 18 V24 M38 18 V24" stroke={c} strokeWidth="2" fill="none" />
      {[10, 24, 38].map((x) => <rect key={x} x={x - 6} y="25" width="12" height="9" rx="2" fill={c} opacity=".55" />)}
    </svg>
  );
}

/** Miniatura de un diseño: fondo, tarjeta, acento y línea. */
function Swatch({ s }: { s: TreeSettings }) {
  const t = resolveTheme(s);
  return (
    <span className="theme-thumb" style={{ background: t.bg }}>
      <span className="tt-card" style={{ background: t.cardBg, borderColor: t.cardBorder, borderRadius: Math.min(t.radius, 14) / 2 }}>
        <i style={{ background: t.accent, borderRadius: t.photoShape === 'circle' ? '50%' : t.photoShape === 'rounded' ? 5 : 2 }} />
        <b style={{ background: t.text }} />
      </span>
      <span className="tt-line" style={{ background: t.edge }} />
    </span>
  );
}

/** Tarjeta de muestra con el diseño actual y la persona central del árbol: se actualiza al instante mientras editas. */
function LivePreview({ s, name, person, central }: { s: TreeSettings; name: string; person: Person | null; central: boolean }) {
  const t = resolveTheme(s);
  const radius = t.photoShape === 'circle' ? '50%' : t.photoShape === 'rounded' ? '24%' : '6px';
  const tint = person?.gender === 'male' ? t.maleTint : person?.gender === 'female' ? t.femaleTint : t.cardBg;
  return (
    <div className="theme-preview" style={{ background: t.bg }}>
      <div className="tp-card" style={{ background: `linear-gradient(180deg, ${tint}, ${t.cardBg} 60%)`, borderColor: t.cardBorder, borderRadius: t.radius * 0.7, color: t.text, fontFamily: t.font }}>
        <div className="tp-photo" style={{ borderColor: t.accent, borderRadius: radius, color: t.accent, background: t.cardBg, fontFamily: t.nameFont }}>
          {person?.photoUrl ? <img src={person.photoUrl} alt="" style={{ borderRadius: radius }} /> : person ? initials(person) : '?'}
        </div>
        <div className="tp-name" style={{ fontFamily: t.nameFont }}>{person ? person.firstName : 'Nombre'}</div>
        <div className="tp-sub">{person ? person.lastName : 'Apellidos'}</div>
        {person && lifespan(person) && <div className="tp-sub" style={{ color: t.muted }}>{lifespan(person)}</div>}
        {(central || !person) && <div className="tp-rel" style={{ background: t.accent, color: '#fff' }}>Persona central</div>}
      </div>
      <div className="tp-info">
        <strong>{name}</strong>
        <small>Vista previa en vivo: así se verán las tarjetas.</small>
        <span className="tp-line" style={{ background: t.edge }} />
      </div>
    </div>
  );
}

const clearStyle = Object.fromEntries(STYLE_KEYS.map((k) => [k, undefined])) as TreeSettings;

export function ThemePanel() {
  const tree = useEditor((s) => s.tree)!;
  const updateTheme = useEditor((s) => s.updateTheme);
  const setLayoutMode = useEditor((s) => s.setLayoutMode);
  const toast = useEditor((s) => s.toast);
  const settings = tree.theme;
  const persons = useEditor((s) => s.persons);
  const previewPerson = (tree.rootPersonId && persons[tree.rootPersonId]) || Object.values(persons)[0] || null;
  const t = resolveTheme(settings);
  const [mine, setMine] = useState<UserTheme[]>([]);
  const [saving, setSaving] = useState<string | null>(null); // nombre del nuevo diseño mientras se escribe
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    api.themes.list().then(setMine).catch(() => undefined);
  }, []);

  const current = mine.find((m) => m.id === settings.userThemeId);
  const dirty = useMemo(
    () => !!current && JSON.stringify(snapshotStyle(settings)) !== JSON.stringify(snapshotStyle(current.theme)),
    [current, settings],
  );
  const overridden = STYLE_KEYS.some((k) => settings[k] !== undefined);

  const applyPreset = (id: string) => updateTheme({ ...clearStyle, preset: id, userThemeId: undefined });
  const applyMine = (m: UserTheme) => updateTheme({ ...clearStyle, ...m.theme, userThemeId: m.id });

  const saveNew = async () => {
    const name = saving?.trim();
    if (!name) return;
    try {
      const created = await api.themes.create(name, snapshotStyle(settings));
      setMine((list) => [...list, created]);
      updateTheme({ userThemeId: created.id });
      setSaving(null);
      toast(`Diseño “${name}” guardado: aparece en “Mis diseños” para todos tus árboles`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const updateCurrent = async () => {
    if (!current) return;
    try {
      const upd = await api.themes.update(current.id, { theme: snapshotStyle(settings) });
      setMine((list) => list.map((m) => (m.id === upd.id ? upd : m)));
      toast(`“${current.name}” actualizado`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const rename = async () => {
    if (!renaming?.name.trim()) return setRenaming(null);
    try {
      const upd = await api.themes.update(renaming.id, { name: renaming.name.trim() });
      setMine((list) => list.map((m) => (m.id === upd.id ? upd : m)));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setRenaming(null);
  };

  const remove = async (m: UserTheme) => {
    if (!confirm(`¿Borrar el diseño “${m.name}”? Los árboles que ya lo usan conservan sus colores.`)) return;
    await api.themes.remove(m.id).catch((e) => toast(e.message, 'error'));
    setMine((list) => list.filter((x) => x.id !== m.id));
  };

  const seg = <T extends string>(value: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="segmented">
      {opts.map(([k, l]) => (
        <button key={k} className={value === k ? 'on' : ''} onClick={() => on(k)}>{l}</button>
      ))}
    </div>
  );

  // Avisos de legibilidad
  const warn: Partial<Record<ColorKey, string>> = {};
  if (contrast(t.text, t.cardBg) < 4.5) warn.text = 'Poco contraste con el fondo de la tarjeta';
  if (contrast(t.muted, t.cardBg) < 3) warn.muted = 'Poco contraste con el fondo de la tarjeta';
  if (contrast('#ffffff', t.accent) < 3) warn.accent = 'Las etiquetas (texto blanco) se leerán mal';
  if (contrast(t.edge, t.bg) < 1.6) warn.edgeColor = 'Las líneas casi no se distinguen del fondo';

  return (
    <aside className="panel">
      <PanelTabs />
      <div className="panel-body theme-panel">
        <LivePreview s={settings} person={previewPerson} central={!!previewPerson && previewPerson.id === tree.rootPersonId} name={current ? current.name : overridden ? `${THEMES.find((x) => x.id === t.id)?.name} (personalizado)` : THEMES.find((x) => x.id === t.id)?.name ?? ''} />

        <Section id="forma" icon={<Network size={15} />} title="Forma del árbol">
          <div className="modes">
            {LAYOUT_MODES.map(([k, title, desc]) => (
              <button
                key={k}
                className={`mode-card ${(settings.layoutMode ?? 'generations') === k ? 'on' : ''}`}
                onClick={() => settings.layoutMode !== k && setLayoutMode(k)}
              >
                <ModeIcon mode={k} />
                <strong>{title}</strong>
                <small>{desc}</small>
              </button>
            ))}
          </div>
          <label className="switch-row">
            <span>
              Ordenar automáticamente
              <small className="switch-help">Al agregar o quitar personas el árbol se reacomoda solo. Desactívalo para conservar tus acomodos manuales.</small>
            </span>
            <input type="checkbox" className="switch" checked={settings.autoArrange !== false} onChange={(e) => updateTheme({ autoArrange: e.target.checked })} />
          </label>
        </Section>

        <Section id="estilos" icon={<Sparkles size={15} />} title="Estilos">
          <h5 className="sub">Prediseñados</h5>
          <div className="presets">
            {THEMES.map((th) => (
              <button key={th.id} className={`preset ${!settings.userThemeId && t.id === th.id && !overridden ? 'on' : ''}`} onClick={() => applyPreset(th.id)}>
                <Swatch s={{ preset: th.id }} />
                <span style={{ fontFamily: th.nameFont }}>{th.name}</span>
              </button>
            ))}
          </div>
          <h5 className="sub">Mis diseños</h5>
          {!mine.length && <p className="empty">Personaliza los colores y guárdalos como diseño propio para usarlos en todos tus árboles.</p>}
          <div className="my-themes">
            {mine.map((m) => (
              <div key={m.id} className={`my-theme ${settings.userThemeId === m.id ? 'on' : ''}`}>
                <button className="mt-apply" onClick={() => applyMine(m)} title="Aplicar a este árbol">
                  <Swatch s={m.theme} />
                  {renaming?.id === m.id ? (
                    <input
                      autoFocus
                      value={renaming.name}
                      maxLength={60}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenaming({ id: m.id, name: e.target.value })}
                      onBlur={rename}
                      onKeyDown={(e) => e.key === 'Enter' && rename()}
                    />
                  ) : (
                    <span>{m.name}</span>
                  )}
                </button>
                <button className="icon-btn" title="Renombrar" onClick={() => setRenaming({ id: m.id, name: m.name })}><Pencil size={13} /></button>
                <button className="icon-btn" title="Borrar diseño" onClick={() => remove(m)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </Section>

        <Section id="colores" icon={<Brush size={15} />} title="Colores" badge={Object.keys(warn).length ? <span className="warn-badge"><AlertTriangle size={12} /></span> : null}>
          {COLOR_GROUPS.map((g) => (
            <div key={g.title} className="color-group">
              <span className="cg-title">{g.title}</span>
              {g.items.map(({ key, label, from }) => {
                const value = String(t[from]);
                const custom = settings[key] !== undefined;
                return (
                  <div key={key} className={`color-row ${custom ? 'custom' : ''}`}>
                    <label className="color-chip" style={{ background: value }} title="Elegir color">
                      <input type="color" value={value} onChange={(e) => updateTheme({ [key]: e.target.value })} aria-label={label} />
                    </label>
                    <span className="cr-label">
                      {label}
                      {warn[key] && <em title={warn[key]}><AlertTriangle size={12} /> {warn[key]}</em>}
                    </span>
                    <input
                      className="hex"
                      value={value}
                      maxLength={7}
                      spellCheck={false}
                      onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && updateTheme({ [key]: e.target.value.toLowerCase() })}
                    />
                    <button
                      className="icon-btn"
                      title="Volver al color del diseño base"
                      style={{ visibility: custom ? 'visible' : 'hidden' }}
                      onClick={() => updateTheme({ [key]: undefined })}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </Section>

        <Section id="tipografia" icon={<Type size={15} />} title="Tipografía" defaultOpen={false}>
          <div className="font-rows">
            {([['nameFont', 'Nombres'], ['font', 'Textos'], ['titleFont', 'Título al exportar']] as const).map(([key, label]) => (
              <label key={key} className="field">
                <span>{label}</span>
                <select value={t[key]} onChange={(e) => updateTheme({ [key]: e.target.value })} style={{ fontFamily: t[key] }}>
                  {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  {!FONTS.some((f) => f.value === t[key]) && <option value={t[key]}>Del diseño</option>}
                </select>
              </label>
            ))}
          </div>
        </Section>

        <Section id="tarjetas" icon={<LayoutTemplate size={15} />} title="Tarjetas y líneas" defaultOpen={false}>
          <h5 className="sub">Foto</h5>
          {seg<PhotoShape>(t.photoShape, [['circle', 'Circular'], ['rounded', 'Redondeada'], ['square', 'Cuadrada']], (v) => updateTheme({ photoShape: v }))}
          <label className="slider-row">
            <span>Esquinas</span>
            <input type="range" min={0} max={28} value={t.radius} onChange={(e) => updateTheme({ radius: Number(e.target.value) })} />
            <small>{t.radius}px</small>
          </label>
          <h5 className="sub">Líneas de conexión</h5>
          {seg<EdgeStyle>(t.edgeStyle, [['smoothstep', 'Escalón suave'], ['step', 'Escalón'], ['default', 'Curva'], ['straight', 'Recta'], ['branch', 'Rama']], (v) => updateTheme({ edgeStyle: v }))}
          <h5 className="sub">Fondo del lienzo</h5>
          {seg<Pattern>(t.pattern, [['dots', 'Puntos'], ['lines', 'Cuadrícula'], ['cross', 'Cruces'], ['none', 'Liso']], (v) => updateTheme({ pattern: v }))}
        </Section>

        <Section id="mostrar" icon={<Eye size={15} />} title="Qué mostrar" defaultOpen={false}>
          <label className="switch-row">
            <span>Fechas y edad</span>
            <input type="checkbox" className="switch" checked={t.showDates} onChange={(e) => updateTheme({ showDates: e.target.checked })} />
          </label>
          <label className="switch-row">
            <span>Parentesco con la persona central</span>
            <input type="checkbox" className="switch" checked={t.showRelations} onChange={(e) => updateTheme({ showRelations: e.target.checked })} />
          </label>
        </Section>

        <div className="theme-actions">
          {current && dirty && (
            <button className="btn primary" onClick={updateCurrent}><Check size={15} /> Guardar cambios en “{current.name}”</button>
          )}
          {saving === null ? (
            <button className="btn" onClick={() => setSaving('')}><Save size={15} /> Guardar como diseño nuevo</button>
          ) : (
            <div className="save-row">
              <input autoFocus placeholder="Nombre del diseño" maxLength={60} value={saving} onChange={(e) => setSaving(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNew()} />
              <button className="btn primary" disabled={!saving.trim()} onClick={saveNew}>Guardar</button>
              <button className="btn ghost" onClick={() => setSaving(null)}>Cancelar</button>
            </div>
          )}
          {overridden && (
            <button className="btn ghost" onClick={() => updateTheme({ ...clearStyle })}>
              <RotateCcw size={15} /> Restablecer al diseño “{THEMES.find((x) => x.id === t.id)?.name}”
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
