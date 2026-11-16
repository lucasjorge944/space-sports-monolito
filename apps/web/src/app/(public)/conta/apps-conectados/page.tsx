import type { Metadata } from 'next';
import { ConnectedAppsView } from '@/components/oauth/connected-apps-view';

export const metadata: Metadata = { title: 'Apps conectados' };

export default function AppsConectadosPage() {
  return <ConnectedAppsView />;
}
