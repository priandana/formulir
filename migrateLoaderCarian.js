const db = require('./db');

async function migrate() {
  console.log('Starting migration to group existing Loader records...');
  
  try {
    const allRecords = await db.getDataCarian();
    const loaderRecords = allRecords.filter(r => r.posisi === 'Loader');
    
    console.log(`Found ${loaderRecords.length} total Loader records in database.`);
    
    // Group by tanggal_carian and batch (truck code)
    const groups = {}; // key: `${tanggal_carian}|${batch}` -> array of records
    for (const r of loaderRecords) {
      const key = `${r.tanggal_carian}|${r.batch}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(r);
    }
    
    let updatedCount = 0;
    let deletedCount = 0;
    
    for (const [key, records] of Object.entries(groups)) {
      const [tanggal_carian, batch] = key.split('|');
      
      // Calculate consolidated values
      const total_output = records.reduce((s, r) => s + (r.total_output || 0), 0);
      const jumlah_toko = records.reduce((s, r) => s + (r.jumlah_toko || 0), 0);
      
      // We will keep the first record and update it, then delete the rest
      const keepRecord = records[0];
      const otherRecords = records.slice(1);
      
      console.log(`Consolidating ${records.length} records for ${tanggal_carian} batch ${batch}:`);
      console.log(`- Keeping ID: ${keepRecord.id}, setting ZONA=LOADER, total_output=${total_output}, jumlah_toko=${jumlah_toko}`);
      
      // Update the kept record
      await db.updateDataCarian(keepRecord.id, {
        zona: 'LOADER',
        total_output,
        jumlah_toko
      });
      updatedCount++;
      
      // Delete the other duplicate records
      for (const r of otherRecords) {
        console.log(`- Deleting duplicate ID: ${r.id}`);
        await db.deleteDataCarian(r.id);
        deletedCount++;
      }
    }
    
    console.log(`\nMigration completed successfully!`);
    console.log(`Updated (consolidated): ${updatedCount} records.`);
    console.log(`Deleted (duplicates): ${deletedCount} records.`);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
