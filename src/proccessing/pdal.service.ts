import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

@Injectable()
export class PdalService {
  private readonly logger = new Logger(PdalService.name);

  private readonly image =
    process.env.PDAL_DOCKER_IMAGE ?? 'ghcr.io/pdal/pdal:latest';

  private async run(workDir: string, args: string[]): Promise<string> {
    const dockerArgs = [
      'run',
      '--rm',
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
        timeout: 60 * 60 * 1000,
      });

      return stdout;
    } catch (error) {
      const err = error as Error & { stderr?: string };

      this.logger.error(err.stderr || err.message);

      throw new Error(`PDAL execution failed: ${err.message}`);
    }
  }

  async inspect(workDir: string, inputFilename: string) {
    const inputPath = `/work/${inputFilename}`;

    const [summaryOutput, metadataOutput] = await Promise.all([
      this.run(workDir, ['info', '--summary', inputPath]),
      this.run(workDir, ['info', '--metadata', inputPath]),
    ]);

    return {
      summary: JSON.parse(summaryOutput),
      metadata: JSON.parse(metadataOutput),
    };
  }

  async convertToCopc(
    workDir: string,
    inputFilename: string,
    outputFilename: string,
  ) {
    const pipeline = [
      {
        type: 'readers.las',
        filename: `/work/${inputFilename}`,
      },
      {
        type: 'writers.copc',
        filename: `/work/${outputFilename}`,
      },
    ];

    await writeFile(
      join(workDir, 'copc-pipeline.json'),
      JSON.stringify(pipeline, null, 2),
      'utf8',
    );

    await this.run(workDir, [
      'pipeline',
      '/work/copc-pipeline.json',
      '--metadata',
      '/work/pipeline-metadata.json',
    ]);

    const pipelineMetadata = JSON.parse(
      await readFile(join(workDir, 'pipeline-metadata.json'), 'utf8'),
    );

    return { pipelineMetadata };
  }
}
