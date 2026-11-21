// A thin notice when the phone loses its connection. The map's streets and
// places, the route and the fares still work offline.
import Icon from './Icon.jsx';
import { useOnline } from '../lib/useOnline.js';
import { t } from '../lib/i18n.js';

export default function OfflineRibbon() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-ribbon" role="status">
      <Icon name="offline" size={15} />{' '}{t("Offline · Routes, fares and place search still work")}
    </div>
  );
}
