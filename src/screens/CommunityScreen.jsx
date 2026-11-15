// Community tips: local commuters share what maps don't know.
import { useState } from 'react';
import { PageHeader } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../lib/auth.jsx';
import { setPrefs } from '../lib/prefs.js';
import { isDemo } from '../lib/supabase.js';
import { useTips, postTip, deleteTip, toggleHelpful, adminSetTipStatus, TIP_CATEGORIES, tipAge } from '../lib/community.js';
import { gpsErrorText } from '../lib/gps.js';

const MAX = 280;

export function TipCard({ tip, route, user, isAdmin, onVote, onDelete, onHide }) {
  const cat = TIP_CATEGORIES[tip.category];
  const stop = tip.stopId ? route.stops.find((s) => s.id === tip.stopId) : null;
  return (
    <article className={`tip-card ${tip.status === 'hidden' ? 'hidden-tip' : ''}`}>
      <div className="tip-head">
        <span className="menu-icon"><Icon name={cat.icon} size={18} /></span>
        <div>
          <b>{cat.label}{stop ? ` · ${stop.short ?? stop.name}` : ''}</b>
          <span className="sub">{tip.author} · {tipAge(tip.createdAt)}{tip.point ? ' · has a location' : ''}{tip.status === 'hidden' ? ' · hidden' : ''}</span>
        </div>
      </div>
      <p className="tip-body">{tip.body}</p>
      <div className="tip-actions">
        <button
          className={`helpful-btn ${tip.voted ? 'on' : ''}`} onClick={() => onVote(tip)} disabled={!user || tip.mine || tip.status === 'hidden'}
          aria-pressed={tip.voted} title={!user ? 'Sign in to vote' : tip.mine ? 'Your tip' : 'Mark as helpful'}
        >
          <Icon name="thumb" size={15} /> Helpful{tip.helpful ? ` · ${tip.helpful}` : ''}
        </button>
        {(tip.mine || isAdmin) && <button className="link-btn small danger-text" onClick={() => onDelete(tip)}>Delete</button>}
        {isAdmin && <button className="link-btn small" onClick={() => onHide(tip)}>{tip.status === 'hidden' ? 'Show again' : 'Hide'}</button>}
      </div>
    </article>
  );
}

export default function CommunityScreen({ route }) {
  const { user, isAdmin } = useAuth();
  const { tips, error, reload, patchTip, removeTip } = useTips(route.id, user?.id ?? null);
  const [filter, setFilter] = useState('all');
  const [writing, setWriting] = useState(false);
  const [category, setCategory] = useState('boarding');
  const [body, setBody] = useState('');
  const [stopId, setStopId] = useState('');
  const [point, setPoint] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const shown = tips.filter((t) => filter === 'all' || t.category === filter);

  async function submit(e) {
    e.preventDefault();
    if (body.trim().length < 5) return setMsg({ kind: 'warn', text: 'Please write a little more (at least 5 letters).' });
    setBusy(true);
    setMsg(null);
    try {
      await postTip({ routeId: route.id, category, body: body.trim(), stopId, point });
      setBody('');
      setStopId('');
      setPoint(null);
      setWriting(false);
      setMsg({ kind: 'ok', text: 'Thanks! Your tip is now visible to other commuters.' });
      await reload();
    } catch (err) {
      setMsg({ kind: 'warn', text: `Couldn’t share: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  function addLocation() {
    if (!navigator.geolocation) return setMsg({ kind: 'warn', text: 'GPS is not available on this device.' });
    navigator.geolocation.getCurrentPosition(
      (p) => setPoint([p.coords.longitude, p.coords.latitude]),
      (err) => setMsg({ kind: 'warn', text: gpsErrorText(err) }),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function vote(tip) {
    try {
      const r = await toggleHelpful(tip.id);
      if (r) patchTip(tip.id, { helpful: r.helpful, voted: r.voted });
    } catch (err) {
      setMsg({ kind: 'warn', text: err.message });
    }
  }

  async function remove(tip) {
    if (!window.confirm('Delete this tip?')) return;
    try {
      await deleteTip(tip.id);
      removeTip(tip.id);
    } catch (err) {
      setMsg({ kind: 'warn', text: err.message });
    }
  }

  async function hide(tip) {
    try {
      const status = tip.status === 'hidden' ? 'visible' : 'hidden';
      await adminSetTipStatus(tip.id, status);
      if (status === 'hidden') removeTip(tip.id); else patchTip(tip.id, { status });
    } catch (err) {
      setMsg({ kind: 'warn', text: err.message });
    }
  }

  return (
    <div className="page">
      <PageHeader title="Community tips" back="routes" />
      <div className="page-body">
        <p className="body-text muted">
          Things local commuters know that maps don’t: where people really wait, route changes, fares, tricycle stands, road work.
          Tips are shared by riders and aren’t checked by us.
        </p>

        {isDemo ? (
          <p className="hint">Community tips work once the database is connected.</p>
        ) : !user ? (
          <div className="card">
            <p className="body-text">Sign in to share a tip or mark tips as helpful.</p>
            <button className="btn primary" onClick={() => setPrefs({ guest: false })}>Sign in</button>
          </div>
        ) : !writing ? (
          <button className="btn primary wide" onClick={() => { setWriting(true); setMsg(null); }}><Icon name="plus" size={18} /> Share a tip</button>
        ) : (
          <form className="card form" onSubmit={submit}>
            <span className="label">What kind of tip?</span>
            <div className="choice-list">
              {Object.entries(TIP_CATEGORIES).map(([id, c]) => (
                <button type="button" key={id} className={`choice ${category === id ? 'on' : ''}`} onClick={() => setCategory(id)}>
                  <span className="radio" />
                  <span><b>{c.label}</b>{c.hint && <small>{c.hint}</small>}</span>
                </button>
              ))}
            </div>
            <label className="field"><span className="label">Your tip</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, MAX))} rows={4} maxLength={MAX}
                placeholder="e.g. Jeepneys to Sta. Cruz stop in front of the 7-Eleven, not at the waiting shed." />
              <span className="fineprint">{body.length}/{MAX} · Don’t include names, phone numbers or plate numbers. Use Report a ride for complaints.</span>
            </label>
            <label className="field"><span className="label">Near a stop (optional)</span>
              <select value={stopId} onChange={(e) => setStopId(e.target.value)}>
                <option value="">No particular stop</option>
                {route.stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="row-between">
              <span className="sub">{point ? 'Your current spot will be attached.' : 'Attach where you are now (optional)'}</span>
              {point
                ? <button type="button" className="link-btn small" onClick={() => setPoint(null)}>Remove</button>
                : <button type="button" className="btn small" onClick={addLocation}><Icon name="locate" size={15} /> Add my spot</button>}
            </div>
            <div className="row-between">
              <button type="button" className="btn" onClick={() => setWriting(false)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Sharing…' : 'Share tip'}</button>
            </div>
          </form>
        )}
        {msg && <p className={msg.kind === 'ok' ? 'ok' : 'warn'}>{msg.text}</p>}
        {error && <p className="warn">Couldn’t load tips: {error}</p>}

        <div className="tip-filter" role="group" aria-label="Filter tips">
          <button className={`chip small ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
          {Object.entries(TIP_CATEGORIES).map(([id, c]) => (
            <button key={id} className={`chip small ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>{c.label}</button>
          ))}
        </div>

        {shown.length ? (
          <div className="tip-list">
            {shown.map((t) => <TipCard key={t.id} tip={t} route={route} user={user} isAdmin={isAdmin} onVote={vote} onDelete={remove} onHide={hide} />)}
          </div>
        ) : (
          <div className="empty compact">
            <span className="empty-icon"><Icon name="chat" size={28} /></span>
            <p>{filter === 'all' ? 'No tips yet. Be the first to share what you know about this route.' : 'No tips of this kind yet.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
