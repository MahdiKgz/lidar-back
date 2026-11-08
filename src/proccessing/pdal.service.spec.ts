import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const execution = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return {
    execFile: Object.assign(() => undefined, {
      [promisify.custom]: execution.run,
    }),
  };
});

import { PdalService } from './pdal.service.js';

// These tests deliberately never execute or install Docker/PDAL.
describe('PdalService COPC verification', () => {
  let dir: string;
  beforeEach(async () => {
    execution.run.mockReset();
    dir = await mkdtemp(join(tmpdir(), 'lidar-pdal-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function header(copc = true) {
    const data = Buffer.alloc(589);
    data.write('LASF');
    data[24] = 1;
    data[25] = 4;
    data.writeUInt16LE(375, 94);
    data.write(copc ? 'copc' : 'other', 377);
    data.writeUInt16LE(1, 393);
    data.writeUInt16LE(160, 395);
    return data;
  }
  it('inspects through a pinned, local-only Docker image with timeouts and cleanup', async () => {
    execution.run.mockImplementation(async (_cmd: string, args: string[]) => ({
      stdout: JSON.stringify(
        args.includes('--summary')
          ? { summary: { num_points: 5, srs: { wkt: 'EPSG:4326' } } }
          : { metadata: {} },
      ),
    }));
    await new PdalService().inspect(dir, 'original.laz');
    const runs = execution.run.mock.calls.filter(
      (call) => call[1][0] === 'run',
    );
    expect(runs).toHaveLength(2);
    for (const call of runs) {
      expect(call[1]).toContain('--pull=never');
      expect(call[1]).toContain('--network=none');
      expect(call[2]).toMatchObject({ timeout: 3600000, maxBuffer: 20971520 });
    }
    expect(
      execution.run.mock.calls.filter((call) => call[1][0] === 'rm'),
    ).toHaveLength(2);
  });

  it.each([
    '{invalid-json',
    JSON.stringify({ summary: { num_points: 0, srs: { wkt: 'EPSG:4326' } } }),
    JSON.stringify({ summary: { num_points: 5, srs: {} } }),
  ])('rejects invalid, empty or unreferenced input %s', async (output) => {
    execution.run.mockResolvedValue({ stdout: output });
    await expect(
      new PdalService().inspect(dir, 'original.laz'),
    ).rejects.toThrow();
  });

  it('sanitizes execution failures and removes timed-out containers', async () => {
    execution.run.mockRejectedValue(new Error('secret output'));
    await expect(
      new PdalService().inspect(dir, 'original.laz'),
    ).rejects.toThrow('inspection failed');
    expect(execution.run.mock.calls.some((call) => call[1][0] === 'rm')).toBe(
      true,
    );
  });

  it('requires the COPC info VLR before asking PDAL to inspect', async () => {
    const service = new PdalService();
    const inspect = vi
      .spyOn(service, 'inspect')
      .mockResolvedValue({ summary: {}, metadata: {} });
    await writeFile(join(dir, 'cloud.laz'), header());
    await service.verifyCopc(dir, 'cloud.laz');
    expect(inspect).toHaveBeenCalledOnce();
  });
  it('rejects ordinary LAS and truncated output', async () => {
    const service = new PdalService();
    const inspect = vi.spyOn(service, 'inspect');
    await writeFile(join(dir, 'cloud.laz'), header(false));
    await expect(service.verifyCopc(dir, 'cloud.laz')).rejects.toThrow(
      'COPC info VLR',
    );
    await writeFile(join(dir, 'cloud.laz'), Buffer.alloc(4));
    await expect(service.verifyCopc(dir, 'cloud.laz')).rejects.toThrow(
      'LAS 1.4',
    );
    expect(inspect).not.toHaveBeenCalled();
  });
  it('rejects paths outside the temporary workspace before execution', async () => {
    const service = new PdalService();
    await expect(service.inspect(dir, '../secret.laz')).rejects.toThrow(
      'filename',
    );
    await expect(
      service.convertToCopc(dir, 'original.laz', '../output.laz'),
    ).rejects.toThrow('filename');
  });
});
