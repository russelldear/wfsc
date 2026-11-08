import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

/** A top-bar menu button with a dropdown. Closes on outside click, Escape, or choosing an item. */
export function Menu(props: { label: ReactNode; active?: boolean; align?: 'left' | 'right'; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const location = useLocation();

  // Close when the route changes.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`menu ${props.align === 'right' ? 'menu-right' : ''}`} ref={ref}>
      <button
        type="button"
        className={`menu-button ${props.active ? 'active' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {props.label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu-list" id={id}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuLink(props: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink to={props.to} end={props.end} className="menu-item">
      {props.children}
    </NavLink>
  );
}
