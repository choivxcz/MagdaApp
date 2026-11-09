// Shared layout pieces: page titles, menu rows, bottom navigation.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

export function navigate(path) {
  window.location.hash = `#/${path}`;
}

// Top-level pages get a large title; sub-pages get a back arrow.
export function PageHeader({ title, subtitle, back, right }) {
  if (!back) {
    return (
      <header className="page-title">
        <div className="page-title-row">
          <h1>{title}</h1>
          {right}
        </div>
        {subtitle && <p>{subtitle}</p>}
      </header>
    );
  }
  return (
    <header className="page-header">
      <button className="icon-btn" onClick={() => (typeof back === 'function' ? back() : navigate(back))} aria-label="Back">
        <Icon name="back" />
      </button>
      <h1>{title}</h1>
      {right ? <div className="page-header-right">{right}</div> : <span className="icon-btn-spacer" />}
    </header>
  );
}

export function MenuGroup({ title, children }) {
  return (
    <section className="menu-group">
      {title && <h2>{title}</h2>}
      <div className="menu-card">{children}</div>
    </section>
  );
}

export function MenuRow({ icon, title, sub, onClick, href, danger, right, badge }) {
  const body = (
    <>
      {icon && <span className={`menu-icon ${danger ? 'danger' : ''}`}><Icon name={icon} size={20} /></span>}
      <span className="menu-text">
        <span className={`menu-title ${danger ? 'danger' : ''}`}>{title}</span>
        {sub && <span className="menu-sub">{sub}</span>}
      </span>
      {badge && <span className="pill">{badge}</span>}
      {right ?? <Icon name="chevron" size={18} className="menu-chevron" />}
    </>
  );
  if (href) return <a className="menu-row" href={href}>{body}</a>;
  if (onClick) return <button className="menu-row" onClick={onClick}>{body}</button>;
  return <div className="menu-row static">{body}</div>;
}

export function BottomNav({ tabs, current }) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {tabs.map((t) => (
        <a key={t.id} href={`#/${t.id}`} className={current === t.id ? 'on' : ''} aria-current={current === t.id ? 'page' : undefined}>
          <Icon name={t.icon} size={23} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

// A sideways-scrolling row of chips. Phones swipe it; computers can also use
// the mouse wheel, click-and-drag, or the ‹ › buttons. Faded edges show
// there is more to see.
export function ScrollRow({ className = '', trackClassName = '', children, ...trackProps }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 4;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);

  useEffect(update); // children may change the width

  useEffect(() => {
    const el = ref.current;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Turn an up/down wheel into sideways scrolling, until the row's end.
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || (e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel); };
  }, [update]);

  // Click-and-drag with a mouse. A drag doesn't count as tapping a chip.
  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true;
      ref.current.setPointerCapture(d.id);
    }
    if (d.moved) ref.current.scrollLeft = d.left - dx;
  };
  const onPointerUp = () => {
    if (drag.current?.moved) {
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      ref.current.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => ref.current?.removeEventListener('click', stop, { capture: true }), 0);
    }
    drag.current = null;
  };

  const page = (dir) => ref.current.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <div className={`scroll-row ${edges.start ? 'more-start' : ''} ${edges.end ? 'more-end' : ''} ${className}`}>
      <div
        ref={ref} className={`scroll-row-track ${trackClassName}`} onScroll={update}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        {...trackProps}
      >
        {children}
      </div>
      {edges.start && (
        <button type="button" className="scroll-arrow start" onClick={() => page(-1)} tabIndex={-1} aria-hidden="true">
          <Icon name="back" size={16} />
        </button>
      )}
      {edges.end && (
        <button type="button" className="scroll-arrow end" onClick={() => page(1)} tabIndex={-1} aria-hidden="true">
          <Icon name="chevron" size={16} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={30} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Segmented({ options, value, onChange, small }) {
  return (
    <div className={`segmented ${small ? 'small' : ''}`} role="group">
      {options.map(([id, label, className = '']) => (
        <button key={id} type="button" className={`${value === id ? 'on' : ''} ${className}`} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// Round profile picture. Shows the first letter of the name (or a person
// icon) when there is no photo or it fails to load.
export function Avatar({ url, name, size = 48, className = '' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (url && !broken) {
    return <img className={`avatar photo ${className}`} src={url} alt="" style={style} onError={() => setBroken(true)} />;
  }
  const letter = name?.trim().slice(0, 1).toUpperCase();
  return (
    <span className={`avatar ${className}`} style={style} aria-hidden="true">
      {letter || <Icon name="user" size={Math.round(size * 0.46)} />}
    </span>
  );
}
