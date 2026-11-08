import { DatasetsController } from './datasets.controller.js';
import type { DatasetsService } from './datasets.service.js';

describe('DatasetsController', () => {
  it('passes UUID strings without numeric conversion', async () => {
    const service = { findOne: vi.fn() };
    const controller = new DatasetsController(
      service as unknown as DatasetsService,
    );
    await controller.findOne('3a2c0001-47d1-47bb-b4eb-439082f3424c');
    expect(service.findOne).toHaveBeenCalledWith(
      '3a2c0001-47d1-47bb-b4eb-439082f3424c',
    );
  });
});
