import { UploadService } from './uploads.service.js';
import { DatasetStatus } from '../datasets/entities/dataset.entity.js';
import { UploadSessionStatus } from './entities/upload-session.entity.js';

function fixture(status = UploadSessionStatus.UPLOADING) {
  const dataset = { id: 'd', fileSize: '3', status: DatasetStatus.UPLOADING };
  const session = {
    id: 's',
    dataset,
    status,
    objectKey: 'original',
    storageUploadId: 'u',
    totalParts: 1,
    partSize: 16777216,
    expiresAt: new Date(Date.now() + 60000),
  };
  const repo = {
    findOne: vi.fn().mockResolvedValue(session),
    update: vi.fn(),
    findOneByOrFail: vi.fn().mockResolvedValue(dataset),
  };
  const manager = {
    query: vi.fn().mockResolvedValue([{ locked: true }]),
    getRepository: vi.fn().mockReturnValue(repo),
  };
  const source = {
    transaction: async (callback: (m: unknown) => unknown) => callback(manager),
  };
  const datasets = { ...repo, manager: { connection: source } };
  const storage = {
    findObjectSize: vi.fn().mockResolvedValue(3),
    getObjectSize: vi.fn().mockResolvedValue(3),
    completeMultipartUpload: vi.fn(),
    abortMultipartUpload: vi.fn(),
    deleteObject: vi.fn(),
  };
  const processing = { dispatchPending: vi.fn() };
  const service = new UploadService(
    datasets as never,
    repo as never,
    storage as never,
    processing as never,
  );
  return { service, repo, storage, processing, manager, session };
}
describe('UploadService recovery', () => {
  it('recovers storage completion after DB failure without repeating MinIO complete', async () => {
    const f = fixture();
    await f.service.completeUpload('s');
    expect(f.storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(f.repo.update).toHaveBeenCalledWith(
      's',
      expect.objectContaining({ status: UploadSessionStatus.COMPLETED }),
    );
  });
  it('keeps successful uploads retryable while Redis is unavailable', async () => {
    const f = fixture(UploadSessionStatus.COMPLETED);
    f.processing.dispatchPending.mockRejectedValue(new Error('Redis down'));
    expect(await f.service.completeUpload('s')).toMatchObject({
      processingEnqueuePending: true,
    });
  });
  it('refuses overlapping operations before touching storage', async () => {
    const f = fixture();
    f.manager.query.mockResolvedValue([{ locked: false }]);
    await expect(f.service.completeUpload('s')).rejects.toThrow('busy');
    expect(f.storage.findObjectSize).not.toHaveBeenCalled();
  });
  it('rejects complete after abort', async () => {
    await expect(
      fixture(UploadSessionStatus.ABORTED).service.completeUpload('s'),
    ).rejects.toThrow('ABORTED');
  });
  it('aborts and deletes a storage-completed object before marking aborted', async () => {
    const f = fixture();
    await f.service.abortUpload('s');
    expect(f.storage.abortMultipartUpload).toHaveBeenCalled();
    expect(f.storage.deleteObject).toHaveBeenCalledWith('original');
  });
});
