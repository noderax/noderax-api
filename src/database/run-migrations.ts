import appDataSource from './typeorm.data-source';

async function run() {
  await appDataSource.initialize();

  try {
    const hasPendingMigrations = await appDataSource.showMigrations();
    if (!hasPendingMigrations) {
      console.log('No pending database migrations.');
      return;
    }

    console.log('Pending database migrations detected. Running migrations.');
    const migrations = await appDataSource.runMigrations();
    console.log(`Applied ${migrations.length} database migration(s).`);
  } finally {
    if (appDataSource.isInitialized) {
      await appDataSource.destroy();
    }
  }
}

run().catch(async (error) => {
  console.error(
    `Database migration runner failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  if (appDataSource.isInitialized) {
    await appDataSource.destroy().catch(() => undefined);
  }
  process.exit(1);
});
