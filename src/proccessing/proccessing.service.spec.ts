import { ProccessingService } from './proccessing.service.js';

describe('Processing queue reliability', () => {
  it('uses deterministic IDs, retries and bounded retention', async () => {
    const queue = { getJob: vi.fn().mockResolvedValue(null), add: vi.fn() };
    const service = new ProccessingService(queue as never, {} as never);
    await service.enqueueDatasetProccessing('id');
    expect(queue.add).toHaveBeenCalledWith(
      'process-dataset',
      { datasetId: 'id' },
      expect.objectContaining({
        jobId: 'dataset-id',
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });
  it('retries retained failed jobs only with a durable explicit retry intent', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('failed'),
      retry: vi.fn(),
    };
    const queue = { getJob: vi.fn().mockResolvedValue(job), add: vi.fn() };
    const service = new ProccessingService(queue as never, {} as never);
    await service.enqueueDatasetProccessing('id');
    expect(job.retry).not.toHaveBeenCalled();
    await service.enqueueDatasetProccessing('id', true);
    expect(job.retry).toHaveBeenCalledWith('failed', {
      resetAttemptsMade: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('never removes an active processing job', async () => {
    const job = {
      getState: vi.fn().mockResolvedValue('active'),
      remove: vi.fn(),
    };
    const service = new ProccessingService(
      { getJob: vi.fn().mockResolvedValue(job) } as never,
      {} as never,
    );
    await expect(service.removeDatasetJob('id')).rejects.toThrow('active');
    expect(job.remove).not.toHaveBeenCalled();
  });
});
