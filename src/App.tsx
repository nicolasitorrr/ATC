import { useEffect, useState } from 'react';
import type { Health } from '../shared/types';
import { Session, type Settings } from './ui/Session';
import { SetupScreen } from './ui/SetupScreen';

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  return settings ? <Session settings={settings} health={health} onExit={() => setSettings(null)} /> : <SetupScreen health={health} onStart={setSettings} />;
}
