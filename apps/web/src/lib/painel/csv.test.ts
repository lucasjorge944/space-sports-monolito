import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('usa ; e CRLF, com BOM', () => {
    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('﻿A;B\r\nx;1\r\n');
  });

  it('protege aspas, separadores e fórmulas', () => {
    expect(toCsv(['n'], [['a;b'], ['diz "oi"'], ['=1+1']])).toBe(
      '﻿n\r\n"a;b"\r\n"diz ""oi"""\r\n\'=1+1\r\n',
    );
  });

  it('neutraliza também tab e CR no início da célula', () => {
    expect(toCsv(['n'], [['\t=1'], ['\r=1']])).toBe('﻿n\r\n\'\t=1\r\n"\'\r=1"\r\n');
  });

  it('não altera números negativos', () => {
    expect(toCsv(['n'], [[-5]])).toBe('﻿n\r\n-5\r\n');
  });
});
