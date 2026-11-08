import 'dotenv/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdalService } from '../dist/proccessing/pdal.service.js';
const workspace = await mkdtemp(join(tmpdir(), 'lidar-runtime-check-'));
try {
  console.log(await new PdalService().verifyRuntime(workspace));
} finally {
  await rm(workspace, { recursive: true, force: true });
}
