import type { SpacePermission } from '@space-sports/api-client';
import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarRange,
  Contact,
  CreditCard,
  GraduationCap,
  History,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Receipt,
  Rocket,
  Star,
  Tags,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react';

export type NavItem = {
  title: string;
  href: string;
  icon?: LucideIcon;
  /** Papel mínimo para ver o item; sem ela o item aparece para todos (a API é a regra de verdade). */
  permission?: SpacePermission;
};
export type NavGroup = { label: string; items: NavItem[] };

/** Seções do painel do espaço (docs/05-design-system.md). */
export const painelNav: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      { title: 'Hoje', href: '/painel', icon: LayoutDashboard },
      { title: 'Agenda', href: '/painel/agenda', icon: CalendarDays },
    ],
  },
  {
    label: 'Reservas',
    items: [
      { title: 'Avulsas', href: '/painel/reservas/avulsas', icon: CalendarRange },
      { title: 'Mensalistas', href: '/painel/reservas/mensalistas', icon: CalendarRange },
    ],
  },
  {
    label: 'Aulas',
    items: [
      {
        title: 'Turmas',
        href: '/painel/aulas/turmas',
        icon: GraduationCap,
        permission: 'classes.view',
      },
      {
        title: 'Sessões',
        href: '/painel/aulas/sessoes',
        icon: GraduationCap,
        permission: 'classes.view',
      },
      {
        title: 'Planos',
        href: '/painel/aulas/planos',
        icon: GraduationCap,
        permission: 'classes.view',
      },
      {
        title: 'Alunos',
        href: '/painel/aulas/alunos',
        icon: GraduationCap,
        permission: 'enrollment.manage',
      },
      {
        title: 'Mensalidades',
        href: '/painel/aulas/mensalidades',
        icon: GraduationCap,
        permission: 'payment.record',
      },
      {
        title: 'Professores',
        href: '/painel/aulas/professores',
        icon: GraduationCap,
        permission: 'classes.view',
      },
      {
        title: 'Relatórios',
        href: '/painel/aulas/relatorios',
        icon: BarChart3,
        permission: 'classes.view',
      },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { title: 'Torneios', href: '/painel/torneios', icon: Trophy },
      { title: 'Recebimentos', href: '/painel/recebimentos', icon: Wallet },
      {
        title: 'Recebimentos online',
        href: '/painel/recebimentos-online',
        icon: CreditCard,
        permission: 'payments.online.manage',
      },
      { title: 'Contatos', href: '/painel/contatos', icon: Contact, permission: 'contact.view' },
      { title: 'Avaliações', href: '/painel/avaliacoes', icon: Star, permission: 'review.view' },
      { title: 'Espaço', href: '/painel/espaco', icon: Building2 },
      { title: 'Equipe', href: '/painel/equipe', icon: Users },
    ],
  },
];

/** Seções do painel da plataforma. */
export const superNav: NavGroup[] = [
  {
    label: 'Plataforma',
    items: [
      { title: 'Dashboard', href: '/super', icon: LayoutDashboard },
      { title: 'Espaços', href: '/super/espacos', icon: Building2 },
      { title: 'Implantações', href: '/super/implantacoes', icon: Rocket },
      { title: 'Financeiro', href: '/super/financeiro', icon: Receipt },
      { title: 'Pagamento online', href: '/super/pagamentos', icon: CreditCard },
      { title: 'Usuários', href: '/super/usuarios', icon: Users },
      { title: 'Contatos', href: '/super/contatos', icon: Contact },
      { title: 'Anúncios', href: '/super/anuncios', icon: Megaphone },
      { title: 'Avaliações', href: '/super/avaliacoes', icon: Star },
      { title: 'Catálogos', href: '/super/catalogos', icon: Tags },
      { title: 'Auditoria', href: '/super/auditoria', icon: History },
    ],
  },
];

export function findNavItem(groups: NavGroup[], href: string) {
  for (const group of groups) {
    const item = group.items.find((i) => i.href === href);
    if (item) return item;
  }
  return undefined;
}
