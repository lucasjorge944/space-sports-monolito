import { describe, expect, it } from 'vitest';
import { emptySpaceForm, toCreateInput, validateSpaceForm } from './space-form';

describe('validateSpaceForm', () => {
  const valid = { ...emptySpaceForm, name: 'Arena Centro', cityId: 'city-1' };

  it('exige nome e cidade', () => {
    expect(validateSpaceForm(emptySpaceForm, 'create')).toMatchObject({
      name: expect.any(String),
      cityId: expect.any(String),
    });
    expect(validateSpaceForm(valid, 'create')).toBeUndefined();
  });

  it('exige o endereço completo quando parte dele foi preenchida', () => {
    const errors = validateSpaceForm({ ...valid, street: 'Rua A' }, 'create');
    expect(errors).toMatchObject({ number: expect.any(String), postalCode: expect.any(String) });
    expect(errors?.street).toBeUndefined();
  });

  it('valida slug, telefone e e-mail do Dono', () => {
    const errors = validateSpaceForm(
      { ...valid, slug: 'Arena Centro', phone: '123', ownerEmail: 'sem-arroba' },
      'create',
    );
    expect(errors).toMatchObject({
      slug: expect.any(String),
      phone: expect.any(String),
      ownerEmail: expect.any(String),
    });
    // O e-mail do Dono só existe na criação.
    expect(validateSpaceForm({ ...valid, ownerEmail: 'x' }, 'edit')).toBeUndefined();
  });
});

describe('toCreateInput', () => {
  it('omite os campos opcionais vazios e normaliza', () => {
    expect(toCreateInput({ ...valid(), ownerEmail: ' Dono@Exemplo.com ' })).toEqual({
      name: 'Arena Centro',
      cityId: 'city-1',
      ownerEmail: 'dono@exemplo.com',
    });
  });

  it('envia o endereço só quando preenchido', () => {
    const input = toCreateInput({
      ...valid(),
      street: ' Rua A ',
      number: '10',
      neighborhood: 'Centro',
      postalCode: '30130-010',
      phone: '(31) 99999-8888',
    });
    expect(input.address).toEqual({
      street: 'Rua A',
      number: '10',
      neighborhood: 'Centro',
      postalCode: '30130010',
    });
    expect(input.phone).toBe('+5531999998888');
  });
});

function valid() {
  return { ...emptySpaceForm, name: 'Arena Centro', cityId: 'city-1' };
}
