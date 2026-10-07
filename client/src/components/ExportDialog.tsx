import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Download, X } from 'lucide-react';
import { useEditor } from '../store';
import { resolveTheme } from '../lib/themes';
import { exportGedcom } from '../lib/gedcom';
import { exportTree, PAPERS, renderToCanvas, resolvePaper, safeDpi, type ExportOptions } from '../lib/export';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const rf = useReactFlow();
  const tree = useEditor((s) => s.tree)!;
  const set = useEditor((s) => s.set);
  const toast = useEditor((s) => s.toast);
  const theme = resolveTheme(tree.theme);
  const [o, setO] = useState<ExportOptions>({
    format: 'pdf',
    paperId: 'letter',
    orientation: 'auto',
    dpi: 200,
    marginMm: 12,
    title: `Familia ${tree.name}`.replace(/^Familia Familia/i, 'Familia'),
    subtitle: '',
    frame: true,
    tileOn: 'none',
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const up = (patch: Partial<ExportOptions>) => setO((x) => ({ ...x, ...patch }));
  // Personas + tronco/anillos decorativos (las uniones son puntos invisibles)
  const persons = () => rf.getNodes().filter((n) => n.type !== 'union');

  // Al abrir, quitar selección/resaltado para que no salgan en la exportación
  useEffect(() => {
    set({ exporting: true });
    return () => set({ exporting: false });
  }, [set]);

  // Vista previa en baja resolución
  const seq = useRef(0);
  useEffect(() => {
    if (o.format === 'svg' || o.format === 'ged') return setPreview(null);
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        await nextFrame();
        const nodes = persons();
        if (!nodes.length) return;
        const { wMm, hMm } = resolvePaper(o, nodes);
        const { canvas } = await renderToCanvas(o, nodes, theme, Math.max(12, 520 / (Math.max(wMm, hMm) / 25.4)));
        if (my === seq.current) setPreview(canvas.toDataURL('image/png'));
      } catch {
        /* la vista previa es opcional */
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, tree.theme]);

  const info = useMemo(() => {
    const nodes = persons();
    if (!nodes.length || o.format === 'svg' || o.format === 'ged') return null;
    const { wMm, hMm } = resolvePaper(o, nodes);
    const dpi = safeDpi(wMm, hMm, o.dpi);
    return { wMm, hMm, dpi, px: `${Math.round((wMm / 25.4) * dpi)} × ${Math.round((hMm / 25.4) * dpi)} px` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o]);

  const run = async () => {
    if (o.format === 'ged') {
      const s = useEditor.getState();
      const text = exportGedcom(
        { persons: Object.values(s.persons), parentChild: s.parentChild, partnerships: s.partnerships },
        tree.name,
      );
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tree.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').toLowerCase()}.ged`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('GEDCOM descargado ✔');
      return;
    }
    setBusy(true);
    try {
      await nextFrame();
      const res = await exportTree(o, persons(), theme);
      if (res.dpi && res.dpi < o.dpi) toast(`El tamaño es muy grande para el navegador; se exportó a ${res.dpi} DPI.`);
      else toast('Exportación lista ✔');
    } catch (e) {
      toast(`No se pudo exportar: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal export-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h3>Exportar e imprimir</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="export-body">
          <div className="export-form">
            <div className="field">
              <span>Formato</span>
              <div className="segmented">
                {(['pdf', 'png', 'svg', 'ged'] as const).map((f) => (
                  <button key={f} className={o.format === f ? 'on' : ''} onClick={() => up({ format: f })}>
                    {f === 'ged' ? 'GEDCOM' : f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {o.format !== 'svg' && o.format !== 'ged' && (
              <>
                <label className="field">
                  <span>Tamaño</span>
                  <select value={o.paperId} onChange={(e) => up({ paperId: e.target.value })}>
                    <option value="fit">Ajustar al tamaño del árbol</option>
                    {(['Hoja', 'Cartel / póster'] as const).map((grp) => (
                      <optgroup key={grp} label={grp}>
                        {PAPERS.filter((p) => p.group === grp).map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {o.paperId !== 'fit' && (
                  <div className="field">
                    <span>Orientación</span>
                    <div className="segmented">
                      {([['auto', 'Automática'], ['portrait', 'Vertical'], ['landscape', 'Horizontal']] as const).map(([k, l]) => (
                        <button key={k} className={o.orientation === k ? 'on' : ''} onClick={() => up({ orientation: k })}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid2">
                  <label className="field">
                    <span>Calidad</span>
                    <select value={o.dpi} onChange={(e) => up({ dpi: Number(e.target.value) })}>
                      <option value={120}>Pantalla (120 DPI)</option>
                      <option value={200}>Buena (200 DPI)</option>
                      <option value={300}>Imprenta (300 DPI)</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Margen (mm)</span>
                    <input type="number" min={0} max={60} value={o.marginMm} onChange={(e) => up({ marginMm: Number(e.target.value) || 0 })} />
                  </label>
                </div>
                <label className="field">
                  <span>Título</span>
                  <input value={o.title} onChange={(e) => up({ title: e.target.value })} placeholder="Sin título" />
                </label>
                <label className="field">
                  <span>Subtítulo</span>
                  <input value={o.subtitle} onChange={(e) => up({ subtitle: e.target.value })} placeholder="p. ej. 1890 – 2026" />
                </label>
                <label className="check">
                  <input type="checkbox" checked={o.frame} onChange={(e) => up({ frame: e.target.checked })} /> Marco decorativo
                </label>
                {o.format === 'pdf' && (
                  <label className="field">
                    <span>Imprimir en casa en varias hojas (mosaico)</span>
                    <select value={o.tileOn} onChange={(e) => up({ tileOn: e.target.value as ExportOptions['tileOn'] })}>
                      <option value="none">No, una sola página</option>
                      <option value="letter">Dividir en hojas Carta</option>
                      <option value="a4">Dividir en hojas A4</option>
                    </select>
                  </label>
                )}
              </>
            )}
            {o.format === 'ged' && (
              <p className="hint">
                Archivo <b>.ged</b> (GEDCOM 5.5.1), el formato estándar de genealogía: sirve para respaldar tu árbol o
                abrirlo en Ancestry, MyHeritage, FamilySearch o Gramps. Incluye nombres, fechas, lugares, notas, parejas y
                tipos de filiación; las fotos van como enlaces.
              </p>
            )}
            {o.format === 'svg' && (
              <p className="hint">SVG vectorial del árbol completo (sin título). Ideal para seguir editando en Illustrator, Inkscape o Canva.</p>
            )}
            {info && (
              <p className="hint">
                {Math.round(info.wMm / 10)} × {Math.round(info.hMm / 10)} cm · {info.px}
                {info.dpi < o.dpi && ` · se ajustará a ${info.dpi} DPI`}
              </p>
            )}
          </div>

          <div className="export-preview">
            {o.format === 'svg' || o.format === 'ged' ? (
              <div className="preview-empty">Vista previa no disponible para {o.format === 'ged' ? 'GEDCOM' : 'SVG'}</div>
            ) : preview ? (
              <img src={preview} alt="Vista previa" />
            ) : (
              <div className="preview-empty">Generando vista previa…</div>
            )}
          </div>
        </div>
        <footer>
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          <button className="btn primary" disabled={busy} onClick={run}>
            <Download size={16} /> {busy ? 'Generando…' : 'Descargar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
