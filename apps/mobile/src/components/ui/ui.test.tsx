import { fireEvent, render, screen } from '@testing-library/react-native';
import { Badge } from './badge';
import { Button, buttonVariants } from './button';
import { Card } from './card';
import { Chip } from './chip';
import { Input } from './input';
import { Text } from './text';

jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));

const classes = (node: { props: { className?: string } }) => node.props.className ?? '';

describe('Button (prancha 06)', () => {
  it('tem 48 de altura, raio 12 e variantes primário, destaque, escuro e contorno', () => {
    expect(buttonVariants()).toContain('h-12');
    expect(buttonVariants()).toContain('rounded-md');
    expect(buttonVariants({ variant: 'default' })).toContain('bg-primary');
    expect(buttonVariants({ variant: 'secondary' })).toContain('bg-secondary');
    expect(buttonVariants({ variant: 'dark' })).toContain('bg-foreground');
    expect(buttonVariants({ variant: 'outline' })).toContain('border-foreground');
  });

  it('o menor tamanho ainda tem alvo de toque de 44', () => {
    expect(buttonVariants({ size: 'sm' })).toContain('h-11');
  });

  it('mostra o anel de foco (offset + anel) ao receber foco e some ao perder', async () => {
    await render(
      <Button testID="b">
        <Text>Reservar</Text>
      </Button>,
    );
    const button = screen.getByTestId('b');
    expect(button.props.style).not.toMatchObject({ boxShadow: expect.anything() });
    await fireEvent(button, 'focus');
    expect(JSON.stringify(screen.getByTestId('b').props.style)).toContain('boxShadow');
    await fireEvent(button, 'blur');
    expect(JSON.stringify(screen.getByTestId('b').props.style)).not.toContain('boxShadow');
  });

  it('mantém o anel de foco e o estilo do chamador quando style é função', async () => {
    await render(
      <Button testID="b" style={() => ({ marginTop: 4 })}>
        <Text>Reservar</Text>
      </Button>,
    );
    await fireEvent(screen.getByTestId('b'), 'focus');
    const style = JSON.stringify(screen.getByTestId('b').props.style);
    expect(style).toContain('boxShadow');
    expect(style).toContain('marginTop');
  });
});

describe('Badge', () => {
  it('status usam os tokens -subtle, com borda', async () => {
    await render(
      <>
        <Badge variant="success" testID="ok">
          <Text>Confirmado</Text>
        </Badge>
        <Badge variant="warning" testID="warn">
          <Text>Pendente</Text>
        </Badge>
        <Badge variant="destructive" testID="bad">
          <Text>Cancelado</Text>
        </Badge>
      </>,
    );
    expect(classes(screen.getByTestId('ok'))).toContain('bg-success-subtle');
    expect(classes(screen.getByTestId('warn'))).toContain('bg-warning-subtle');
    expect(classes(screen.getByTestId('warn'))).toContain('border-warning-subtle-border');
    expect(classes(screen.getByTestId('bad'))).toContain('bg-destructive-subtle');
    expect(classes(screen.getByText('Confirmado'))).toContain('text-success-subtle-foreground');
  });
});

describe('Chip', () => {
  it('neutro nos dois temas, com o Sol só no selecionado (tokens chip*)', async () => {
    await render(
      <>
        <Chip selected testID="on">
          <Text>Futevôlei</Text>
        </Chip>
        <Chip testID="off">
          <Text>Vôlei</Text>
        </Chip>
      </>,
    );
    expect(classes(screen.getByTestId('on'))).toContain('bg-chip-selected');
    expect(classes(screen.getByTestId('on'))).toContain('border-chip-selected-border');
    expect(classes(screen.getByTestId('off'))).toContain('bg-chip');
    expect(classes(screen.getByTestId('off'))).toContain('active:bg-chip-hover');
    expect(classes(screen.getByText('Futevôlei'))).toContain('text-chip-selected-foreground');
    expect(classes(screen.getByText('Vôlei'))).toContain('text-chip-foreground');
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  it('horário (slot) seleciona em Mar/Sol com cantos 12', async () => {
    await render(
      <Chip selected shape="slot" testID="slot">
        <Text>19:00</Text>
      </Chip>,
    );
    expect(classes(screen.getByTestId('slot'))).toContain('bg-primary');
    expect(classes(screen.getByTestId('slot'))).toContain('rounded-md');
  });
});

describe('Chip: estados', () => {
  it('desabilitado apaga o texto', async () => {
    await render(
      <Chip disabled>
        <Text>Vôlei</Text>
      </Chip>,
    );
    expect(classes(screen.getByText('Vôlei'))).toContain('text-muted-foreground');
  });

  it('mantém o anel de foco e o estilo do chamador quando style é função', async () => {
    await render(
      <Chip style={() => ({ marginTop: 4 })} testID="chip">
        <Text>Vôlei</Text>
      </Chip>,
    );
    await fireEvent(screen.getByTestId('chip'), 'focus');
    const style = JSON.stringify(screen.getByTestId('chip').props.style);
    expect(style).toContain('boxShadow');
    expect(style).toContain('marginTop');
  });
});

describe('Input', () => {
  it('tem 48 de altura e usa os tokens de campo no foco', async () => {
    await render(<Input testID="campo" />);
    expect(classes(screen.getByTestId('campo'))).toContain('h-12');
    expect(classes(screen.getByTestId('campo'))).toContain('border-input');
    await fireEvent(screen.getByTestId('campo'), 'focus');
    expect(classes(screen.getByTestId('campo'))).toContain('border-input-focus');
    expect(classes(screen.getByTestId('campo'))).toContain('bg-input-focus-background');
    expect(classes(screen.getByTestId('campo'))).not.toContain('border-2');
    await fireEvent(screen.getByTestId('campo'), 'blur');
    expect(classes(screen.getByTestId('campo'))).toContain('border-input');
  });

  it('o erro vence o foco', async () => {
    await render(<Input testID="campo" invalid />);
    await fireEvent(screen.getByTestId('campo'), 'focus');
    expect(classes(screen.getByTestId('campo'))).toContain('border-input-error');
    expect(classes(screen.getByTestId('campo'))).toContain('bg-input-error-background');
    expect(classes(screen.getByTestId('campo'))).not.toContain('border-input-focus');
  });

  it('desabilitado usa os tokens, sem opacidade', async () => {
    await render(<Input testID="campo" editable={false} />);
    expect(classes(screen.getByTestId('campo'))).toContain('border-disabled');
    expect(classes(screen.getByTestId('campo'))).toContain('bg-input-disabled');
    expect(classes(screen.getByTestId('campo'))).not.toContain('opacity-50');
  });
});

describe('Card e Text', () => {
  it('card comum usa raio 16 (o 24 é do card de espaço)', async () => {
    await render(<Card testID="card" />);
    expect(classes(screen.getByTestId('card'))).toContain('rounded-lg');
    expect(classes(screen.getByTestId('card'))).not.toContain('rounded-xl');
  });

  it('títulos usam Space Grotesk; o corpo, Inter', async () => {
    await render(
      <>
        <Text variant="h3">Título</Text>
        <Text variant="price">R$ 80,00</Text>
        <Text>Corpo</Text>
      </>,
    );
    expect(classes(screen.getByText('Título'))).toContain('font-display-semibold');
    expect(classes(screen.getByText('R$ 80,00'))).toContain('font-display-semibold');
    expect(classes(screen.getByText('Corpo'))).toContain('font-sans');
  });
});
