import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

/** All dataset mutations share the same PostgreSQL lock as the processing worker. */
export async function withDatasetLock<T>(
  source: DataSource,
  datasetId: string,
  action: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return source.transaction(async (manager) => {
    const rows: { locked: boolean }[] = await manager.query(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
      [datasetId],
    );
    if (!rows[0]?.locked) {
      throw new ConflictException('Dataset is busy. Retry the request later.');
    }
    return action(manager);
  });
}
