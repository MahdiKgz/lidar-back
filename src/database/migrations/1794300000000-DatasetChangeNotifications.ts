import type { MigrationInterface, QueryRunner } from 'typeorm';
export class DatasetChangeNotifications1794300000000 implements MigrationInterface {
  name = 'DatasetChangeNotifications1794300000000';
  async up(runner: QueryRunner) {
    await runner.query(`CREATE FUNCTION lidar_notify_dataset_change() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          PERFORM pg_notify('lidar_dataset_changes', json_build_object('id', OLD.id, 'operation', TG_OP)::text);
          RETURN OLD;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW."processingError" IS NOT DISTINCT FROM OLD."processingError" THEN
            RETURN NEW;
          END IF;
        END IF;
        PERFORM pg_notify('lidar_dataset_changes', json_build_object('id', NEW.id, 'operation', TG_OP)::text);
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await runner.query(
      `CREATE TRIGGER lidar_dataset_changed AFTER INSERT OR UPDATE OR DELETE ON datasets FOR EACH ROW EXECUTE FUNCTION lidar_notify_dataset_change()`,
    );
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TRIGGER lidar_dataset_changed ON datasets');
    await runner.query('DROP FUNCTION lidar_notify_dataset_change()');
  }
}
