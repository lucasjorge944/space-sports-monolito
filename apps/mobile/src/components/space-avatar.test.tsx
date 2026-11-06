import { fireEvent, render, screen } from '@testing-library/react-native';
import { SpaceAvatar, spaceInitials } from './space-avatar';

// A logo é decorativa (fora da árvore de acessibilidade): as consultas precisam enxergar os ocultos.
const HIDDEN = { includeHiddenElements: true };

describe('spaceInitials', () => {
  it('usa a primeira e a última palavra, ignorando conectivos', () => {
    expect(spaceInitials('Duna Sports')).toBe('DS');
    expect(spaceInitials('Arena do Sol Beach')).toBe('AB');
    expect(spaceInitials('  astral ')).toBe('A');
    expect(spaceInitials('')).toBe('?');
  });
});

describe('SpaceAvatar (RF-SPACE-11)', () => {
  it('mostra a logo quando existe', async () => {
    await render(<SpaceAvatar name="Duna Sports" logoUrl="https://cdn.test/logo.png" />);
    expect(screen.getByTestId('space-avatar-image', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('space-avatar-initials', HIDDEN)).toBeNull();
  });

  it('sem logo, mostra as iniciais do nome', async () => {
    await render(<SpaceAvatar name="Duna Sports" logoUrl={null} />);
    expect(screen.getByTestId('space-avatar-initials', HIDDEN)).toHaveTextContent('DS');
    expect(screen.queryByTestId('space-avatar-image', HIDDEN)).toBeNull();
  });

  it('se a imagem falhar, cai para as iniciais', async () => {
    await render(<SpaceAvatar name="Errejota Beach" logoUrl="https://cdn.test/quebrada.png" />);
    await fireEvent(screen.getByTestId('space-avatar-image', HIDDEN), 'error', {
      nativeEvent: { error: 'falhou' },
    });
    expect(screen.getByTestId('space-avatar-initials', HIDDEN)).toHaveTextContent('EB');
  });
});
