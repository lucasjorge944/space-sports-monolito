import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedCssFiles } from './css';

describe('CSS gerado', () => {
  it.each(Object.entries(generatedCssFiles))(
    'generated/%s está sincronizado com src/ (rode `pnpm generate`)',
    (file, generate) => {
      const committed = readFileSync(join(__dirname, '..', 'generated', file), 'utf8');
      expect(committed).toBe(generate());
    },
  );
});
