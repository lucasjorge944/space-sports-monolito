import { brandLogos, logoMinWidth } from '@space-sports/ui-tokens';
import { render, screen } from '@testing-library/react-native';
import { Logo } from './logo';

let mockTheme: 'light' | 'dark' = 'light';
jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => mockTheme }));

const mockSvgXml = jest.fn((_props: { xml: string; width: number; height: number }) => null);
jest.mock('react-native-svg', () => ({
  SvgXml: (props: { xml: string; width: number; height: number }) => mockSvgXml(props),
}));

const lastXml = () => mockSvgXml.mock.calls.at(-1)?.[0];

describe('Logo', () => {
  beforeEach(() => {
    mockTheme = 'light';
    mockSvgXml.mockClear();
  });

  it('expõe o nome da marca como imagem acessível', async () => {
    await render(<Logo />);
    expect(screen.getByLabelText('Space Sports')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Space Sports' })).toBeTruthy();
  });

  it('auto: positiva no tema claro e negativa no escuro', async () => {
    await render(<Logo variant="vertical" />);
    expect(lastXml()?.xml).toContain('ss-clip-logo-vertical');
    expect(lastXml()?.xml).not.toContain('logo-vertical-negative');

    mockTheme = 'dark';
    await render(<Logo variant="vertical" />);
    expect(lastXml()?.xml).toContain('ss-clip-logo-vertical-negative');
  });

  it('escolhe a versão pelo layout e pelo tom', async () => {
    await render(<Logo variant="horizontal" tone="on-sol" />);
    expect(lastXml()?.xml).toContain('ss-clip-logo-horizontal-on-sol');
    await render(<Logo variant="symbol" tone="negative" />);
    expect(lastXml()?.xml).toContain('ss-clip-symbol-negative');
  });

  it('mantém a proporção do arquivo e respeita o mínimo digital', async () => {
    const asset = brandLogos.vertical.positive;
    if (!asset) throw new Error('logo vertical ausente');
    await render(<Logo variant="vertical" width={200} />);
    expect(lastXml()?.width).toBe(200);
    expect(lastXml()?.height).toBeCloseTo((200 * asset.height) / asset.width);

    await render(<Logo variant="horizontal" width={80} />);
    expect(lastXml()?.width).toBe(logoMinWidth.horizontal);
  });

  it('o id do clipPath é único entre instâncias', async () => {
    await render(
      <>
        <Logo variant="symbol" />
        <Logo variant="symbol" />
      </>,
    );
    const [a, b] = mockSvgXml.mock.calls.slice(-2).map(([props]) => props.xml);
    expect(a).not.toEqual(b);
  });
});
