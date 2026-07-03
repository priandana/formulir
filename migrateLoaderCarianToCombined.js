const db = require('./db');

async function migrate() {
  console.log('Starting migration to update LOADER zone name to uppercase combined list...');
  
  try {
    const allRecords = await db.getDataCarian();
    const loaderRecords = allRecords.filter(r => r.posisi === 'Loader' && r.zona === 'LOADER');
    
    console.log(`Found ${loaderRecords.length} Loader records with zone 'LOADER' in database.`);
    
    let updatedCount = 0;
    
    for (const r of loaderRecords) {
      console.log(`Updating record ID: ${r.id} (${r.tanggal_carian} batch ${r.batch}) to ZONA='AMBIENT, CHILLER, FREEZER'`);
      await db.updateDataCarian(r.id, {
        zona: 'AMBIENT, CHILLER, FREEZER'
      });
      updatedCount++;
    }
    
    console.log(`\nMigration completed successfully!`);
    console.log(`Updated: ${updatedCount} records.`);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
