// One Community post (a local route, a terminal or a tip), its comments,
// and the sheets for reporting and for the person who posted it.
import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { Avatar } from './ui.jsx';
import { haptic } from '../lib/haptics.js';
import { setPrefs } from '../lib/prefs.js';
import { TIP_CATEGORIES, tipAge } from '../lib/community.js';
import {
  VEHICLES, POST_KINDS, REPORT_REASONS, targetOf, fareText,
  listComments, addComment, deleteComment, reportContent, blockAuthor, contributorCard,
} from '../lib/communityPosts.js';

const signIn = () => setPrefs({ guest: false });

export function Byline({ name, driver, when, children }) {
  return (
    <div className="post-by">
      <Avatar name={name === 'Anonymous commuter' ? '' : name} size={32} className={name === 'Anonymous commuter' ? 'ghost' : ''} />
      <div>
        <b>{name}{driver && <span className="driver-badge" title="Verified jeepney driver"><Icon name="badge" size={12} /> Driver</span>}</b>
        <span className="sub">{tipAge(when)}</span>
      </div>
      {children}
    </div>
  );
}

// A small "•••" menu.
export function Menu({ items, label = 'More options' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="menu-wrap">
      <button type="button" className="icon-btn small" aria-label={label} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
        <Icon name="dots" size={18} />
      </button>
      {open && (
        <div className="pop-menu" role="menu">
          {shown.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'danger-text' : ''} onClick={() => { setOpen(false); it.onClick(); }}>
              <Icon name={it.icon} size={16} /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Comments({ post, user, isAdmin, onCount }) {
  const kind = targetOf(post);
  const [list, setList] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reporting, setReporting] = useState(null);

  useEffect(() => {
    let alive = true;
    listComments(kind, post.id).then((l) => alive && setList(l)).catch((e) => alive && setMsg(e.message));
    return () => { alive = false; };
  }, [kind, post.id]);

  async function send(e) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await addComment(kind, post.id, body.trim());
      setBody('');
      const l = await listComments(kind, post.id);
      setList(l);
      onCount(l.length);
      haptic.tap();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c) {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await deleteComment(c.id);
      const l = list.filter((x) => x.id !== c.id);
      setList(l);
      onCount(l.length);
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="comments">
      {list == null && !msg && <p className="sub">Loading comments…</p>}
      {list?.length === 0 && <p className="sub">No comments yet.</p>}
      {list?.map((c) => (
        <div key={c.id} className="comment">
          <Avatar name={c.author} size={26} />
          <div className="comment-body">
            <span className="comment-head"><b>{c.author}</b>{c.authorDriver && <span className="driver-badge"><Icon name="badge" size={11} /> Driver</span>}<span className="sub">{tipAge(c.createdAt)}</span></span>
            <span>{c.body}</span>
          </div>
          <Menu items={[
            (c.mine || isAdmin) && { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(c) },
            user && !c.mine && { label: 'Report', icon: 'flag', onClick: () => setReporting(c) },
          ]} />
        </div>
      ))}
      {user ? (
        <form className="comment-form" onSubmit={send}>
          <input value={body} onChange={(e) => setBody(e.target.value.slice(0, 500))} placeholder="Write a comment…" maxLength={500} aria-label="Write a comment" />
          <button className="send-btn" disabled={busy || !body.trim()} aria-label="Post comment"><Icon name="send" size={18} /></button>
        </form>
      ) : (
        <p className="sub"><button type="button" className="link-btn small" onClick={signIn}>Sign in</button> to comment.</p>
      )}
      {msg && <p className="warn small">{msg}</p>}
      {reporting && <ReportSheet kind="comment" id={reporting.id} what="comment" onClose={() => setReporting(null)} onDone={() => { setList(list.filter((x) => x.id !== reporting.id)); }} />}
    </div>
  );
}

export function PostCard({ post, route, user, isAdmin, onVote, onConfirm, onHelpful, onDelete, onShowOnMap, onReport, onBlock, onProfile, onPatch }) {
  const [showComments, setShowComments] = useState(false);
  const kind = POST_KINDS[post.kind];
  const isTip = post.kind === 'tip';
  const tipCat = isTip ? TIP_CATEGORIES[post.category] ?? TIP_CATEGORIES.other : null;
  const stop = post.stopId ? route.stops.find((s) => s.id === post.stopId) : null;
  const approved = post.status === 'approved' || isTip;
  const fares = !isTip ? fareText(post.fares) : '';

  return (
    <article className={`post-card ${post.status === 'review' ? 'in-review' : ''} ${post.status === 'rejected' ? 'rejected' : ''}`}>
      <Byline name={post.author} driver={post.authorDriver} when={post.createdAt}>
        {post.status === 'review' && <span className="pill">In review</span>}
        {post.status === 'rejected' && <span className="pill warn-pill">Not approved</span>}
        <Menu items={[
          (post.point || post.path) && { label: 'Show on map', icon: 'map', onClick: () => onShowOnMap(post) },
          post.author !== 'Anonymous commuter' && { label: `About ${post.author}`, icon: 'user', onClick: () => onProfile(post) },
          user && !post.mine && { label: 'Report', icon: 'flag', onClick: () => onReport(post) },
          user && !post.mine && post.author !== 'Anonymous commuter' && { label: `Block ${post.author}`, icon: 'block', onClick: () => onBlock(post) },
          (post.mine || isAdmin) && { label: 'Delete', icon: 'trash', danger: true, onClick: () => onDelete(post) },
        ]} />
      </Byline>

      <div className="post-title">
        <span className={`post-kind ${post.kind}`}><Icon name={isTip ? tipCat.icon : kind.icon} size={16} /></span>
        <div>
          <b>{isTip ? tipCat.label : post.name}{stop ? ` · ${stop.short ?? stop.name}` : ''}</b>
          <span className="sub">
            {isTip ? 'Tip' : `${kind.label} · ${post.vehicles.map((v) => VEHICLES[v]?.label ?? v).join(', ')}`}
          </span>
        </div>
      </div>
      {post.body && <p className="tip-body">{post.body}</p>}
      {(fares || post.hours) && (
        <dl className="post-facts">
          {fares && <><dt>Fare</dt><dd>{fares}</dd></>}
          {post.hours && <><dt>Hours</dt><dd>{post.hours}</dd></>}
        </dl>
      )}
      {post.status === 'rejected' && post.reviewNote && <p className="warn small">Admin: {post.reviewNote}</p>}
      {post.status === 'review' && <p className="sub">Only you can see this until an admin checks it (usually within a day).</p>}
      {(post.point || post.path) && (
        <button type="button" className="link-btn small post-map-link" onClick={() => onShowOnMap(post)}><Icon name="map" size={14} /> Show on map</button>
      )}

      {approved && (
        <div className="post-actions">
          {isTip ? (
            <button className={`helpful-btn ${post.myVote ? 'on' : ''}`} onClick={() => (user ? onHelpful(post) : signIn())} disabled={post.mine} aria-pressed={!!post.myVote}>
              <Icon name="thumb" size={15} /> Helpful{post.up ? ` · ${post.up}` : ''}
            </button>
          ) : (
            <>
              <button className={`vote-btn ${post.myVote === 1 ? 'on' : ''}`} onClick={() => (user ? onVote(post, post.myVote === 1 ? 0 : 1) : signIn())} disabled={post.mine} aria-pressed={post.myVote === 1} aria-label="Upvote">
                <Icon name="thumb" size={15} /> {post.up}
              </button>
              <button className={`vote-btn down ${post.myVote === -1 ? 'on' : ''}`} onClick={() => (user ? onVote(post, post.myVote === -1 ? 0 : -1) : signIn())} disabled={post.mine} aria-pressed={post.myVote === -1} aria-label="Downvote">
                <Icon name="thumb" size={15} className="flip" /> {post.down}
              </button>
            </>
          )}
          <button className={`vote-btn ${showComments ? 'on' : ''}`} onClick={() => setShowComments(!showComments)} aria-expanded={showComments} aria-label="Comments">
            <Icon name="comment" size={15} /> {post.comments}
          </button>
          {kind.confirm && (
            <button className={`confirm-btn ${post.myConfirm ? 'on' : ''}`} onClick={() => (user ? onConfirm(post) : signIn())} aria-pressed={post.myConfirm}>
              <Icon name="check" size={15} /> {kind.confirm}{post.confirms ? ` · ${post.confirms}` : ''}
            </button>
          )}
        </div>
      )}
      {showComments && <Comments post={post} user={user} isAdmin={isAdmin} onCount={(n) => onPatch(post.id, { comments: n })} />}
    </article>
  );
}

// Report a post, tip, comment or chat message.
export function ReportSheet({ kind, id, what = 'post', onClose, onDone, canBlock = false }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(false);
  const [state, setState] = useState(null); // null | 'sending' | 'sent' | error

  async function send(e) {
    e.preventDefault();
    if (!reason) return setState('Choose a reason.');
    setState('sending');
    try {
      await reportContent(kind, id, reason, note.trim());
      if (block) await blockAuthor(kind, id);
      setState('sent');
      haptic.success();
      onDone?.({ blocked: block });
    } catch (err) {
      setState(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" role="dialog" aria-modal="true" aria-label={`Report this ${what}`} onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <div className="modal-head">
          <b>Report this {what}</b>
          <button type="button" className="icon-btn small" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        {state === 'sent' ? (
          <>
            <p className="ok">Thanks. The admin will look at it. When 3 people report the same thing, it is hidden right away.</p>
            <button type="button" className="btn primary wide" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <p className="sub">Why are you reporting this? The person won’t know it was you.</p>
            <div className="choice-list">
              {Object.entries(REPORT_REASONS).map(([k, label]) => (
                <button type="button" key={k} className={`choice ${reason === k ? 'on' : ''}`} onClick={() => setReason(k)}>
                  <span className="radio" /><span><b>{label}</b></span>
                </button>
              ))}
            </div>
            <label className="field"><span className="label">Tell us more (optional)</span>
              <textarea rows={2} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="What’s wrong with it?" />
            </label>
            {canBlock && (
              <label className="switch-label"><span>Also block this person</span>
                <input type="checkbox" className="switch" checked={block} onChange={(e) => setBlock(e.target.checked)} />
              </label>
            )}
            {state && state !== 'sending' && <p className="warn small">{state}</p>}
            <button className="btn primary wide" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send report'}</button>
          </>
        )}
      </form>
    </div>
  );
}

// "About Maria": what this person has shared (first name only).
export function ContributorSheet({ kind, id, onClose, onBlock, canBlock }) {
  const [card, setCard] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    contributorCard(kind, id).then(setCard).catch((e) => setError(e.message));
  }, [kind, id]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label="Contributor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Contributor</b>
          <button type="button" className="icon-btn small" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        {error && <p className="warn">{error}</p>}
        {!card && !error && <p className="sub">Loading…</p>}
        {card && (
          <>
            <div className="contributor">
              <Avatar name={card.anonymous ? '' : card.name} size={56} />
              <div>
                <b>{card.name}{card.isDriver && <span className="driver-badge"><Icon name="badge" size={12} /> Verified driver</span>}</b>
                <span className="sub">{card.joined ? `Community contributor since ${card.joined.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}` : 'Community contributor'}</span>
              </div>
            </div>
            {!card.anonymous && (
              <div className="detail-stats">
                <span><small>Routes</small><b>{card.routes}</b></span>
                <span><small>Terminals</small><b>{card.terminals}</b></span>
                <span><small>Tips</small><b>{card.tips}</b></span>
                <span><small>Comments</small><b>{card.comments}</b></span>
              </div>
            )}
            {canBlock && !card.anonymous && <button type="button" className="btn wide" onClick={onBlock}><Icon name="block" size={16} /> Block {card.name}</button>}
          </>
        )}
      </section>
    </div>
  );
}
