import { EventEmitter } from 'node:events';
import { DatasetEventsService } from './dataset-events.service.js';

describe('Dataset SSE', () => {
  it('delivers committed notifications, progress and heartbeat; unsubscribes cleanly', async () => {
    vi.useFakeTimers();
    const pg = new EventEmitter();
    const runner = {
      connect: vi.fn().mockResolvedValue(pg),
      query: vi.fn().mockResolvedValue([]),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const dataset = { id: 'd', status: 'READY' };
    const repo = {
      manager: { connection: { createQueryRunner: () => runner } },
      findOne: vi.fn().mockResolvedValue(dataset),
    };
    const service = new DatasetEventsService(repo as never);
    const messages: { type?: string; data?: unknown }[] = [];
    const subscription = service
      .stream()
      .subscribe((event) => messages.push(event));
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    pg.emit('notification', {
      channel: 'lidar_dataset_changes',
      payload: JSON.stringify({ id: 'd', operation: 'UPDATE' }),
    });
    await vi.advanceTimersByTimeAsync(0);
    service.progress('d', 70);
    await vi.advanceTimersByTimeAsync(15000);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'connected' }),
    );
    expect(messages).toContainEqual({ type: 'dataset-updated', data: dataset });
    expect(messages).toContainEqual({
      type: 'dataset-progress',
      data: { id: 'd', progress: 70 },
    });
    expect(messages).toContainEqual({ type: 'heartbeat', data: {} });
    subscription.unsubscribe();
    const count = messages.length;
    service.progress('d', 100);
    await vi.advanceTimersByTimeAsync(15000);
    expect(messages).toHaveLength(count);
    await service.onModuleDestroy();
    expect(pg.listenerCount('notification')).toBe(0);
    expect(runner.release).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
