import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Sección plegable que recuerda si la dejaste abierta o cerrada. */
export function Section(props: { id: string; icon: ReactNode; title: string; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const key = `raices.section.${props.id}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? props.defaultOpen ?? true : v === '1';
    } catch {
      return props.defaultOpen ?? true;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1');
      } catch {
        /* sin almacenamiento: sólo no se recuerda */
      }
      return !o;
    });
  };
  return (
    <section className={`pp-section ${open ? 'open' : ''}`}>
      <button className="pp-section-head" onClick={toggle} aria-expanded={open}>
        <span className="pp-section-icon">{props.icon}</span>
        <span className="pp-section-title">{props.title}</span>
        {props.badge}
        <ChevronDown size={16} className="chev" />
      </button>
      {open && <div className="pp-section-body">{props.children}</div>}
    </section>
  );
}

