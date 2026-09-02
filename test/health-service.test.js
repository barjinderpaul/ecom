import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHealthService } from '../src/services/health.service.js';

describe('createHealthService', () => {
  it('reports ok when every check resolves', async () => {
    const service = createHealthService({ checks: { mysql: async () => {}, elasticsearch: async () => {} } });
    assert.deepEqual(await service.check(), { status: 'ok', checks: { mysql: 'up', elasticsearch: 'up' } });
  });

  it('reports degraded with the failing dependency named', async () => {
    const service = createHealthService({
      checks: {
        mysql: async () => {},
        elasticsearch: async () => {
          throw new Error('refused');
        },
      },
    });
    assert.deepEqual(await service.check(), {
      status: 'degraded',
      checks: { mysql: 'up', elasticsearch: 'down' },
    });
  });
});
