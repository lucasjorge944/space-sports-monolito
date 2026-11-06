import { describe, expect, it } from 'vitest';
import { availableStatusActions } from './space-status';

describe('availableStatusActions', () => {
  it('segue as transições da API', () => {
    expect(availableStatusActions('ACTIVE')).toEqual(['suspend', 'close']);
    expect(availableStatusActions('SUSPENDED')).toEqual(['reactivate', 'close']);
    expect(availableStatusActions('CLOSED')).toEqual(['reactivate']);
  });
});
