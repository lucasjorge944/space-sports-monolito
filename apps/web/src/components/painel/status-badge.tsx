import { Badge } from '@/components/ui/badge';
import type { BadgeTone } from '@/lib/painel/labels';

export function StatusBadge({ info }: { info: { label: string; tone: BadgeTone } }) {
  return <Badge variant={info.tone}>{info.label}</Badge>;
}
