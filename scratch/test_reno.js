const db = require('./db');

async function test() {
  try {
    const res21 = await db.getRekapPenggajian('2026-06-21', '2026-07-13');
    const reno21 = res21.pekerja.find(p => p.nama.toLowerCase().includes('reno'));
    console.log('=== RANGE 21 JUN - 13 JUL ===');
    console.log('Reno Maulana:', JSON.stringify(reno21, null, 2));

    const res23 = await db.getRekapPenggajian('2026-06-23', '2026-07-13');
    const reno23 = res23.pekerja.find(p => p.nama.toLowerCase().includes('reno'));
    console.log('=== RANGE 23 JUN - 13 JUL ===');
    console.log('Reno Maulana:', JSON.stringify(reno23, null, 2));

    // Get detail submissions
    const details21 = await db.getDetailSubmissionsAndLoader('2026-06-21', '2026-07-13');
    const renoDetails21 = details21.filter(d => d.nama.toLowerCase().includes('reno'));
    console.log(`\nDetail Carian Reno (21 Jun - 13 Jul) count: ${renoDetails21.length}`);
    const totalCalc21 = renoDetails21.reduce((sum, d) => sum + d.total_nilai, 0);
    console.log(`Sum of details 21-Jun: Rp ${totalCalc21.toLocaleString('id-ID')}`);

    const details23 = await db.getDetailSubmissionsAndLoader('2026-06-23', '2026-07-13');
    const renoDetails23 = details23.filter(d => d.nama.toLowerCase().includes('reno'));
    console.log(`\nDetail Carian Reno (23 Jun - 13 Jul) count: ${renoDetails23.length}`);
    const totalCalc23 = renoDetails23.reduce((sum, d) => sum + d.total_nilai, 0);
    console.log(`Sum of details 23-Jun: Rp ${totalCalc23.toLocaleString('id-ID')}`);

  } catch (err) {
    console.error(err);
  }
}

test();
