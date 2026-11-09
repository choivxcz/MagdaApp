import { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Avatar } from './ui.jsx';
import { uploadPhoto, removePhoto } from '../lib/photos.js';

// Add, change or remove one photo: the profile picture ("avatar") or the
// jeepney photo ("jeepney"). onChanged() should reload the photo links.
export default function PhotoField({ kind, userId, url, name, title, sub, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  async function run(label, job, done) {
    setBusy(label);
    setMsg(null);
    try {
      await job();
      await onChanged?.();
      setMsg({ ok: true, text: done });
    } catch (err) {
      setMsg({ ok: false, text: err.message || String(err) });
    } finally {
      setBusy('');
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still works
    if (file) run('Uploading…', () => uploadPhoto(userId, kind, file), 'Photo saved.');
  }

  function onRemove() {
    if (!window.confirm('Remove this photo?')) return;
    run('Removing…', () => removePhoto(userId, kind), 'Photo removed.');
  }

  const preview = kind === 'avatar' ? (
    <Avatar url={url} name={name} size={76} />
  ) : url ? (
    <img className="jeep-photo-img" src={url} alt="Your jeepney" />
  ) : (
    <div className="jeep-photo-empty"><Icon name="bus" size={30} /><span>No jeepney photo yet</span></div>
  );

  return (
    <div className={`photo-field ${kind}`}>
      <div className="photo-preview">{preview}</div>
      <div className="photo-text">
        <b>{title}</b>
        {sub && <span className="sub">{sub}</span>}
        <div className="row">
          <button type="button" className="btn small icon-text" onClick={() => input.current?.click()} disabled={!!busy}>
            <Icon name="camera" size={16} /> {busy || (url ? 'Change photo' : 'Add photo')}
          </button>
          {url && !busy && <button type="button" className="btn small" onClick={onRemove}>Remove</button>}
        </div>
        {msg && <p className={msg.ok ? 'ok' : 'warn'}>{msg.text}</p>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}
