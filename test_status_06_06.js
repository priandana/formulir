const db = require('./db');

async function test() {
  console.log("=== Testing 2026-06-06 ===");
  try {
    const records = await db.getDataCarianWithStatus('2026-06-06');
    console.log(`Total records: ${records.length}`);
    const nonZero = records.filter(r => r.sudah_diisi > 0);
    console.log(`Records with sudah_diisi > 0: ${nonZero.length}`);
    nonZero.slice(0, 10).forEach(r => {
      console.log(`  Posisi: ${r.posisi} | Zona: ${r.zona} | Batch: ${r.batch} | Kapasitas: ${r.total_output} | Terisi: ${r.sudah_diisi} | Sisa: ${r.sisa}`);
    });
  } catch (err) {
    console.error(err);
  }

  console.log("\n=== Testing 2026-06-08 ===");
  try {
    const records = await db.getDataCarianWithStatus('2026-06-08');
    console.log(`Total records: ${records.length}`);
    const nonZero = records.filter(r => r.sudah_diisi > 0);
    console.log(`Records with sudah_diisi > 0: ${nonZero.length}`);
    nonZero.slice(0, 10).forEach(r => {
      console.log(`  Posisi: ${r.posisi} | Zona: ${r.zona} | Batch: ${r.batch} | Kapasitas: ${r.total_output} | Terisi: ${r.sudah_diisi} | Sisa: ${r.sisa}`);
    });
  } catch (err) {
    console.error(err);
  }
}

test();
