import { render, screen } from '@testing-library/react-native';
import { RatingBadge } from './rating-badge';

describe('RatingBadge (docs/05, "Avaliações (2)")', () => {
  it('com média, usa o testID recebido', async () => {
    await render(<RatingBadge rating={{ count: 23, average: 4.8 }} testID="card-nota" />);
    expect(screen.getByTestId('card-nota')).toHaveTextContent('4,8 (23)');
  });

  it('"Novo" também usa o testID recebido', async () => {
    await render(<RatingBadge rating={{ count: 2, average: 4 }} testID="card-nota" />);
    expect(screen.getByTestId('card-nota')).toHaveTextContent('Novo');
    expect(screen.queryByTestId('selo-novo')).toBeNull();
  });

  it('sem testID, os padrões "selo-avaliacao" e "selo-novo"', async () => {
    await render(<RatingBadge rating={null} />);
    expect(screen.getByTestId('selo-novo')).toBeTruthy();
  });
});
