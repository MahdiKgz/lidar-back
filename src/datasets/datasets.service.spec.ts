import { Test, TestingModule } from '@nestjs/testing';
import { DatasetsService } from './datasets.service.js';

describe('DatasetsService', () => {
  let service: DatasetsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DatasetsService],
    }).compile();

    service = module.get<DatasetsService>(DatasetsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
