// Shared layout pieces: page titles, menu rows, bottom navigation.
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
