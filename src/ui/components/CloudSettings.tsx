import { useEffect, useState } from 'react';
import { cloudHealth, getDeviceKey, isCloudSyncEnabled, setCloudSyncEnabled, setDeviceKey } from '../../lib/cloud/client';

export function CloudSettings({ onChange }: { onChange?: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [on, setOn] = useState(isCloudSyncEnabled());
  const [showKey, setShowKey] = useState(false);
  useEffect(() => {
    cloudHealth().then((h) => setAvailable(!!h?.storage.d1 && !!h.storage.r2));
  }, []);
  return (
    <div className="panel space-y-4 p-5 text-sm">
      <p className="text-ink-300">
        Activity files can contain precise locations (e.g. your home). By default everything stays in this browser (IndexedDB) — it is
        not a backup and is lost if you clear site data. Cloud sync stores projects, activity tracks and media privately in this
        app's Cloudflare storage, readable only with your sync key.
      </p>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={!available}
          onChange={(e) => {
            setCloudSyncEnabled(e.target.checked);
            setOn(e.target.checked);
            onChange?.();
          }}
        />
        <span>
          Cloud sync{' '}
          {available === null ? <em className="text-ink-400">(checking…)</em> : available ? <span className="text-ok">(available)</span> : <span className="text-ink-400">(not configured on this deployment)</span>}
        </span>
      </label>
      {on && (
        <div className="space-y-2">
          <div className="label">Sync key — treat like a password</div>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" readOnly type={showKey ? 'text' : 'password'} value={getDeviceKey()} />
            <button className="btn" onClick={() => setShowKey((s) => !s)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button className="btn" onClick={() => navigator.clipboard.writeText(getDeviceKey())}>
              Copy
            </button>
          </div>
          <button
            className="btn"
            onClick={() => {
              const k = prompt('Paste the sync key from your other device. Projects saved with the current key will no longer be visible here.');
              if (k && !setDeviceKey(k)) alert('That is not a valid sync key.');
              else if (k) onChange?.();
            }}
          >
            Use a key from another device…
          </button>
        </div>
      )}
    </div>
  );
}
