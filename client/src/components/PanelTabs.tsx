import { Palette, UserRound, X } from 'lucide-react';
import { useEditor } from '../store';

/** Pestañas del panel derecho: un solo panel visible a la vez, se cambia sin perder la selección. */
export function PanelTabs() {
  const panel = useEditor((s) => s.panel);
  const selectedId = useEditor((s) => s.selectedId);
  const person = useEditor((s) => (s.selectedId ? s.persons[s.selectedId] : null));
  const readOnly = useEditor((s) => s.readOnly);
  const openPanel = useEditor((s) => s.openPanel);
  const select = useEditor((s) => s.select);

  return (
    <div className="panel-tabs">
      <button
        className={panel === 'person' ? 'on' : ''}
        disabled={!selectedId}
        onClick={() => openPanel('person')}
        title={selectedId ? 'Ficha de la persona seleccionada' : 'Selecciona a alguien en el lienzo'}
      >
        <UserRound size={15} /> <span>{person ? person.firstName : 'Persona'}</span>
      </button>
      {!readOnly && (
        <button className={panel === 'design' ? 'on' : ''} onClick={() => openPanel('design')}>
          <Palette size={15} /> <span>Diseño</span>
        </button>
      )}
      <div className="spacer" />
      <button
        className="close"
        title="Cerrar panel (Esc)"
        onClick={() => {
          if (panel === 'person') select(null);
          openPanel(null);
        }}
      >
        <X size={17} />
      </button>
    </div>
  );
}
