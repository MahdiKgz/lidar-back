import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { basename, join } from 'node:path';
import { open, readFile, writeFile } from 'node:fs/promises';

import type { PdalInspection } from './processing.types.js';

const execFileAsync = promisify(execFile);

@Injectable()
export class PdalService {
  private readonly mode = process.env.PDAL_MODE ?? 'docker';
  private readonly timeout = Number(process.env.PDAL_TIMEOUT_MS ?? 3600000);
  private readonly image =
    process.env.PDAL_DOCKER_IMAGE ??
    'ghcr.io/pdal/pdal@sha256:b7f250d102e68e67c2b35fbc63fa18f32ca248d5d42bea61e644a2e030afd6b0';

  private async run(workDir: string, args: string[]): Promise<string> {
    if (this.mode === 'native') {
      try {
        const { stdout } = await execFileAsync('pdal', args, {
          cwd: workDir,
          encoding: 'utf8',
          timeout: this.timeout,
          maxBuffer: 20 * 1024 * 1024,
        });
        return stdout;
      } catch {
        throw new Error('PDAL execution failed or exceeded its timeout.');
      }
    }
    const containerName = `lidar-pdal-${randomUUID()}`;
    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--pull=never',
      '--network=none',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--mount',
      `type=bind,source=${workDir},target=/work`,
      '--workdir',
      '/work',
      '--entrypoint',
      'pdal',
      this.image,
      ...args,
    ];

    try {
      const { stdout } = await execFileAsync('docker', dockerArgs, {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        timeout: this.timeout,
      });

      return stdout;
    } catch {
      throw new Error('PDAL execution failed or exceeded its timeout.');
    } finally {
      // Killing the Docker CLI on timeout does not stop the running container.
      await execFileAsync('docker', ['rm', '--force', containerName], {
        timeout: 10000,
      }).catch(() => undefined);
    }
  }

  private filePath(workDir: string, filename: string): string {
    return this.mode === 'native'
      ? join(workDir, filename)
      : `/work/${filename}`;
  }

  async verifyRuntime(workDir: string): Promise<{ version: string }> {
    const version = await this.run(workDir, ['--version']);
    const drivers = await this.run(workDir, ['--drivers']);
    if (!drivers.includes('readers.las') || !drivers.includes('writers.copc')) {
      throw new Error('PDAL requires readers.las and writers.copc drivers.');
    }
    return { version: version.trim() };
  }

  private assertFilename(filename: string): void {
    if (
      !filename ||
      basename(filename) !== filename ||
      !/^[a-zA-Z0-9._-]+$/.test(filename)
    ) {
      throw new Error('Invalid PDAL workspace filename.');
    }
  }

  async inspect(
    workDir: string,
    inputFilename: string,
  ): Promise<PdalInspection> {
    this.assertFilename(inputFilename);
    const inputPath = this.filePath(workDir, inputFilename);

    const results = await Promise.allSettled([
      this.run(workDir, ['info', '--summary', inputPath]),
      this.run(workDir, ['info', '--metadata', inputPath]),
    ]);

    const [summaryResult, metadataResult] = results;
    if (
      summaryResult.status === 'rejected' ||
      metadataResult.status === 'rejected'
    ) {
      throw new Error('PDAL inspection failed.');
    }
    const summaryOutput = summaryResult.value;
    const metadataOutput = metadataResult.value;
    const summary = JSON.parse(summaryOutput) as Record<string, unknown>;
    const metadata = JSON.parse(metadataOutput) as Record<string, unknown>;
    const info = summary?.summary as Record<string, unknown> | undefined;
    if (
      !info ||
      typeof info.num_points !== 'number' ||
      info.num_points <= 0 ||
      !Number.isSafeInteger(info.num_points) ||
      !metadata ||
      typeof metadata !== 'object'
    ) {
      throw new Error('PDAL returned invalid or empty point cloud metadata.');
    }
    const srs = info.srs as Record<string, unknown> | undefined;
    if (!srs || !(srs.wkt || srs.compoundwkt || srs.horizontal)) {
      throw new Error('Point cloud has no known coordinate reference system.');
    }
    return { summary, metadata };
  }

  async verifyCopc(workDir: string, filename: string): Promise<PdalInspection> {
    this.assertFilename(filename);
    const file = await open(join(workDir, filename), 'r');
    try {
      const header = Buffer.alloc(375);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      if (
        bytesRead < 375 ||
        header.toString('ascii', 0, 4) !== 'LASF' ||
        header[24] !== 1 ||
        header[25] !== 4
      ) {
        throw new Error('Output is not LAS 1.4.');
      }
      const vlr = Buffer.alloc(54);
      await file.read(vlr, 0, vlr.length, header.readUInt16LE(94));
      if (
        vlr.toString('ascii', 2, 18).replace(/\0/g, '') !== 'copc' ||
        vlr.readUInt16LE(18) !== 1 ||
        vlr.readUInt16LE(20) !== 160
      ) {
        throw new Error('Output is missing the COPC info VLR.');
      }
    } finally {
      await file.close();
    }
    return this.inspect(workDir, filename);
  }

  async convertToCopc(
    workDir: string,
    inputFilename: string,
    outputFilename: string,
  ) {
    this.assertFilename(inputFilename);
    this.assertFilename(outputFilename);
    const pipeline = [
      {
        type: 'readers.las',
        filename: this.filePath(workDir, inputFilename),
      },
      {
        type: 'writers.copc',
        forward: 'all',
        filename: this.filePath(workDir, outputFilename),
      },
    ];

    await writeFile(
      join(workDir, 'copc-pipeline.json'),
      JSON.stringify(pipeline, null, 2),
      'utf8',
    );

    await this.run(workDir, [
      'pipeline',
      this.filePath(workDir, 'copc-pipeline.json'),
      '--metadata',
      this.filePath(workDir, 'pipeline-metadata.json'),
    ]);

    const pipelineMetadata = JSON.parse(
      await readFile(join(workDir, 'pipeline-metadata.json'), 'utf8'),
    );

    return { pipelineMetadata };
  }
}
