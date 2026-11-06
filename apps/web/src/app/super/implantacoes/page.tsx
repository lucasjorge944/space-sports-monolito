import type { Metadata } from 'next';
import { OnboardingList } from '@/components/super/spaces/onboarding-list';

export const metadata: Metadata = { title: 'Implantações' };

export default function OnboardingPage() {
  return <OnboardingList />;
}
