import { DatasetsService } from './datasets.service.js';
import type { Repository } from 'typeorm';
import { Dataset } from './entities/dataset.entity.js';
import type { StorageService } from '../storage/storage.service.js';
import type { ProccessingService } from '../proccessing/proccessing.service.js';

describe('DatasetsService', () => {
  it('returns 404 for a missing dataset', async () => {
    const service = new DatasetsService(
      {
        findOneBy: vi.fn().mockResolvedValue(null),
      } as unknown as Repository<Dataset>,
      {} as StorageService,
      {} as ProccessingService,
    );
    await expect(service.findOne('missing')).rejects.toThrow(
      'Dataset not found',
    );
  });
});
