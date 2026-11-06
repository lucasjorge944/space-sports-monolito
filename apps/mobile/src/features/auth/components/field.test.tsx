import { maskPhone } from '@space-sports/shared';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { validatePhone } from '@/features/auth/validation';
import { Field, FormError } from './field';
import { useFormField, validateFields } from './use-form-field';

jest.mock('@/theme/theme-provider', () => ({ useThemeName: () => 'light' }));

function PhoneField() {
  const phone = useFormField({ validate: validatePhone, format: maskPhone });
  return <Field label="Telefone" testID="campo" {...phone.bind} />;
}

const message = 'Informe o telefone com DDD';

describe('Field (doc 05, anatomia de campo)', () => {
  it('a dica continua visível quando o erro entra', async () => {
    await render(<Field label="Senha" hint="Mínimo de 8 caracteres" error="Use mais letras" />);
    expect(screen.getByText('Mínimo de 8 caracteres')).toBeTruthy();
    expect(screen.getByText('Use mais letras')).toBeTruthy();
  });

  it('a dica de contexto pode sair durante o erro', async () => {
    await render(<Field label="Telefone" hint="Só para avisos" error="Erro" hideHintOnError />);
    expect(screen.queryByText('Só para avisos')).toBeNull();
  });

  it('o erro chega ao leitor de tela pelo rótulo e pela dica de acessibilidade', async () => {
    await render(
      <Field label="Nome" testID="campo" hint="Como aparece" error="Informe seu nome" />,
    );
    const input = screen.getByTestId('campo');
    expect(input.props.accessibilityLabel).toBe('Nome, com erro');
    expect(input.props.accessibilityHint).toBe('Informe seu nome. Como aparece');
  });

  it('marca o opcional no rótulo, sem asterisco', async () => {
    await render(<Field label="Motivo" optional testID="campo" />);
    expect(screen.getByTestId('campo').props.accessibilityLabel).toBe('Motivo (opcional)');
    expect(screen.getByText('(opcional)', { exact: false })).toBeTruthy();
  });

  it('erro geral vira alerta', async () => {
    await render(<FormError message="Sem conexão" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('sem erro, não ocupa espaço', async () => {
    await render(<FormError message={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('useFormField', () => {
  it('aplica a máscara e não valida durante a primeira digitação', async () => {
    await render(<PhoneField />);
    await fireEvent.changeText(screen.getByTestId('campo'), '3199');
    expect(screen.getByTestId('campo').props.value).toBe('(31) 99');
    expect(screen.queryByText(message)).toBeNull();
  });

  it('valida ao sair e revalida a cada alteração depois do erro', async () => {
    await render(<PhoneField />);
    await fireEvent.changeText(screen.getByTestId('campo'), '3199');
    await fireEvent(screen.getByTestId('campo'), 'blur');
    expect(screen.getByText(message)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('campo'), '31999998888');
    expect(screen.queryByText(message)).toBeNull();
  });

  it('campo vazio e intocado não dá erro ao sair', async () => {
    await render(<PhoneField />);
    await fireEvent(screen.getByTestId('campo'), 'blur');
    expect(screen.queryByText(message)).toBeNull();
  });

  it('ao enviar, foca o primeiro inválido e anuncia a mensagem', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    const { result } = await renderHook(() => ({
      name: useFormField({ initial: 'Ana' }),
      phone: useFormField({ validate: validatePhone }),
      code: useFormField({ validate: () => 'Outro erro' }),
    }));
    const focus = jest.fn();
    let valid = true;
    await act(async () => {
      const { name, phone, code } = result.current;
      valid = validateFields([name, { ...phone, focus }, { ...code, focus: jest.fn() }]);
    });
    expect(valid).toBe(false);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(message);
    expect(result.current.code.error).toBe('Outro erro');
    announce.mockRestore();
  });
});
