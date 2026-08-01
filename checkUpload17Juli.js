// checkUpload17Juli.js — Cek data Excel upload carian 17 Juli 2026
require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const { Pool } = require('pg');

const FILE = 'DATA UPLOAD CARIAN 17072026 (1).xlsx';

// ── Baca Excel ───────────────────────────────────────────────────────────────
const wb = XLSX.readFile(FILE);
console.log('=== CEK DATA UPLOAD CARIAN 17 JULI 2026 ===');
console.log('File:', FILE);
console.log('Sheets ditemukan:', wb.SheetNames.join(', '));
console.log('');

// ── Fungsi helper ─────────────────────────────────────────────────────────────
function parseSheet(raw) {
  return raw.map(r => r.map(c => (c === null || c === undefined) ? '' : String(c).trim()));
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOADER SHEET
// ═══════════════════════════════════════════════════════════════════════════════
const loaderSheetName = wb.SheetNames.find(n =>
  n.toLowerCase().includes('load') || n.toLowerCase().includes('kontainer')
);

const excelLoader = {}; // { "ZONA_BATCH": kont }

if (loaderSheetName) {
  console.log(`[LOADER] Sheet: "${loaderSheetName}"`);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[loaderSheetName], { header: 1, defval: '' });
  const ZONES = ['F1','R1','R2','R3','T1','T2','T3','T4','T5','B01','B02','B03','B04','B05','B06'];
  let zoneHeaderRowIdx = -1;
  const zoneColMap = {};

  for (let i = 0; i < 20; i++) {
    const row = raw[i].map(c => String(c).trim().toUpperCase());
    const found = ZONES.filter(z => row.includes(z));
    if (found.length >= 2) {
      zoneHeaderRowIdx = i;
      ZONES.forEach(zone => {
        const idx = row.indexOf(zone);
        if (idx !== -1) zoneColMap[zone] = { batchCol: idx, kontCol: idx + 1 };
      });
      break;
    }
  }

  console.log(`  Zone header row: ${zoneHeaderRowIdx + 1}`);
  console.log(`  Zones found: ${Object.keys(zoneColMap).join(', ')}`);

  const dataStart = zoneHeaderRowIdx + 2;
  for (let r = dataStart; r < raw.length; r++) {
    const no = raw[r][0];
    if (typeof no !== 'number' || no <= 0 || !Number.isInteger(no)) continue;
    Object.entries(zoneColMap).forEach(([zone, { batchCol, kontCol }]) => {
      const bv = String(raw[r][batchCol] || '').trim();
      const kv = parseInt(raw[r][kontCol]) || 0;
      if (!bv || bv === '0' || kv <= 0) return;
      const key = `${zone}_${bv}`;
      excelLoader[key] = (excelLoader[key] || 0) + kv;
    });
  }

  console.log(`\n  Data Loader dari Excel (${Object.keys(excelLoader).length} kombinasi zona+batch):`);
  Object.entries(excelLoader).forEach(([key, total]) => {
    const [zona, ...bParts] = key.split('_');
    console.log(`    zona=${zona}, batch=${bParts.join('_')}, kont=${total}`);
  });
} else {
  console.log('[LOADER] Sheet tidak ditemukan!');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SORTER SHEET
// ═══════════════════════════════════════════════════════════════════════════════
const sorterSheetName = wb.SheetNames.find(n => n.toLowerCase().includes('sort'));
const excelSorter = {}; // { "ZONA_BATCH": kont }

if (sorterSheetName) {
  console.log(`\n[SORTER] Sheet: "${sorterSheetName}"`);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sorterSheetName], { header: 1, defval: '' });

  // Cari zona
  let zonaVal = '';
  for (let i = 0; i < 10; i++) {
    const rowStr = raw[i].join('|').toUpperCase();
    if (rowStr.includes('ZONA')) {
      for (let j = 0; j < raw[i].length; j++) {
        const v = String(raw[i][j]).trim();
        if (v && !v.toUpperCase().includes('ZONA') && !v.toUpperCase().includes('TYPE') && !v.toUpperCase().includes('TANGGAL')) {
          zonaVal = v; break;
        }
      }
      break;
    }
  }
  console.log(`  Zona: ${zonaVal || '(tidak ditemukan)'}`);

  // Cari batchTableCols
  let batchHeaderRowIdx = -1;
  const batchTableCols = [];
  for (let i = 0; i < 12; i++) {
    const rowStr = raw[i].join('|').toUpperCase();
    if (rowStr.includes('BATCH') && rowStr.match(/[A-Z]\d/)) {
      batchHeaderRowIdx = i;
      raw[i].forEach((cell, colIdx) => {
        const m = String(cell).trim().match(/^([A-Z0-9]+)\s+BATCH\s+(\d+)$/i);
        if (m) batchTableCols.push({ batchNum: m[2], batchName: String(cell).trim(), kontCol: colIdx + 3, startCol: colIdx });
      });
      break;
    }
  }

  // Cari TOT KONT rows
  const totKontRows = [];
  raw.forEach((row, i) => {
    if (String(row[0]).toUpperCase().includes('TOT') || String(row[1]).toUpperCase().includes('TOT'))
      totKontRows.push(i);
  });

  console.log(`  Batches: ${batchTableCols.map(b => b.batchName).join(', ')}`);
  const dataStartRow = batchHeaderRowIdx + 2;
  batchTableCols.forEach(({ batchNum, batchName, kontCol, startCol }, idx) => {
    const endRow = totKontRows[idx] !== undefined ? totKontRows[idx] : raw.length - 1;
    let totalKont = 0;
    for (let r = dataStartRow; r < endRow; r++) {
      const no = raw[r][startCol];
      if (typeof no === 'number' && no > 0) totalKont += parseInt(raw[r][kontCol]) || 0;
    }
    const key = `${zonaVal}_${batchNum}`;
    if (totalKont > 0) {
      excelSorter[key] = totalKont;
      console.log(`  ✅ ${batchName}: ${totalKont} kontainer`);
    } else {
      console.log(`  ⚠️  ${batchName}: total=0 (skip)`);
    }
  });
} else {
  console.log('\n[SORTER] Sheet tidak ditemukan!');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PICKER SHEET
// ═══════════════════════════════════════════════════════════════════════════════
const pickerSheetName = wb.SheetNames.find(n => n.toLowerCase().includes('picker'));
const excelPicker = {}; // { "ZONA_BATCH": pcs }

if (pickerSheetName) {
  console.log(`\n[PICKER] Sheet: "${pickerSheetName}"`);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[pickerSheetName], { header: 1, defval: '' });
  let batchNameRowIdx = -1;
  for (let i = 0; i < 15; i++) {
    if (raw[i].join('|').toUpperCase().includes('BATCH') && !raw[i].join('|').toUpperCase().includes('TOTAL')) {
      batchNameRowIdx = i; break;
    }
  }
  let subTotalRowIdx = -1;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (String(raw[i][0]).toUpperCase().includes('TOTAL')) { subTotalRowIdx = i; break; }
  }
  if (batchNameRowIdx !== -1 && subTotalRowIdx !== -1) {
    const batchNameRow = raw[batchNameRowIdx];
    const subTotalRow = raw[subTotalRowIdx];
    for (let col = 3; col < batchNameRow.length; col += 2) {
      let bh = '';
      for (let off = -1; off <= 2; off++) {
        const c = String(batchNameRow[col + off] || '').trim();
        if (c.toUpperCase().includes('BATCH')) { bh = c; break; }
      }
      const qty = parseInt(subTotalRow[col]);
      if (isNaN(qty) || qty <= 0 || !bh) continue;
      const m = bh.match(/^([A-Z0-9]+)\s+BATCH\s+(\d+)$/i);
      if (!m) continue;
      const key = `${m[1]}_${m[2]}`;
      excelPicker[key] = (excelPicker[key] || 0) + qty;
      console.log(`  ✅ zona=${m[1]}, batch=${m[2]}, qty=${qty} pcs`);
    }
  } else {
    console.log('  ⚠️  Tidak bisa parse Picker (batchNameRow/subTotalRow tidak ketemu)');
  }
} else {
  console.log('\n[PICKER] Sheet tidak ditemukan!');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RINGKASAN EXCEL
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n');
console.log('════════════════════════════════════════');
console.log('RINGKASAN DATA EXCEL 17 JULI 2026');
console.log('════════════════════════════════════════');

// Total loader
let totalLoaderKont = 0;
const loaderByBatch = {};
Object.entries(excelLoader).forEach(([key, kont]) => {
  totalLoaderKont += kont;
  const parts = key.split('_');
  const batch = parts[parts.length - 1];
  loaderByBatch[batch] = (loaderByBatch[batch] || 0) + kont;
});

console.log(`\nLOADER — Total Kontainer: ${totalLoaderKont}`);
Object.entries(loaderByBatch).sort().forEach(([b, k]) => {
  console.log(`  Batch ${b}: ${k} kont`);
});

// Total sorter
let totalSorterKont = 0;
Object.entries(excelSorter).forEach(([key, kont]) => {
  totalSorterKont += kont;
});
console.log(`\nSORTER — Total Kontainer: ${totalSorterKont}`);
Object.entries(excelSorter).forEach(([key, kont]) => {
  console.log(`  ${key}: ${kont} kont`);
});

// Total picker
let totalPickerPcs = 0;
Object.entries(excelPicker).forEach(([key, pcs]) => {
  totalPickerPcs += pcs;
});
console.log(`\nPICKER — Total Pcs: ${totalPickerPcs}`);
Object.entries(excelPicker).forEach(([key, pcs]) => {
  console.log(`  ${key}: ${pcs} pcs`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARE KE DATABASE
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n');
console.log('════════════════════════════════════════');
console.log('COMPARE EXCEL vs DATABASE (17 Juli 2026)');
console.log('════════════════════════════════════════');

async function compareWithDB() {
  let pool;
  try {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      console.log('⚠️  DATABASE_URL tidak ditemukan di .env — skip compare DB');
      return;
    }
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

    // Ambil data dari DB untuk tanggal 17 Juli 2026
    const tanggal = '2026-07-17';
    const res = await pool.query(`
      SELECT posisi, zona, batch, total_output, satuan
      FROM data_carian
      WHERE tanggal = $1
      ORDER BY posisi, zona, batch
    `, [tanggal]);

    const dbRows = res.rows;
    console.log(`\nTotal rows di DB (tanggal ${tanggal}): ${dbRows.length}`);

    // Group DB by posisi
    const dbLoader = {};
    const dbSorter = {};
    const dbPicker = {};

    dbRows.forEach(r => {
      const key = `${r.zona}_${r.batch}`;
      if (r.posisi === 'Loader') dbLoader[key] = Number(r.total_output);
      else if (r.posisi === 'Sorter') dbSorter[key] = Number(r.total_output);
      else if (r.posisi === 'Picker') dbPicker[key] = Number(r.total_output);
    });

    // ── Compare LOADER ──────────────────────────────────────────────────────
    console.log('\n--- LOADER ---');
    const loaderKeys = new Set([...Object.keys(excelLoader), ...Object.keys(dbLoader)]);
    let loaderOk = true;
    loaderKeys.forEach(key => {
      const exV = excelLoader[key] || 0;
      const dbV = dbLoader[key] || 0;
      const status = exV === dbV ? '✅' : '❌';
      if (exV !== dbV) loaderOk = false;
      console.log(`  ${status} ${key}: Excel=${exV}, DB=${dbV}${exV !== dbV ? ' ← BEDA!' : ''}`);
    });
    if (loaderOk && loaderKeys.size > 0) console.log('  ✅ Semua data Loader cocok!');

    // ── Compare SORTER ──────────────────────────────────────────────────────
    console.log('\n--- SORTER ---');
    const sorterKeys = new Set([...Object.keys(excelSorter), ...Object.keys(dbSorter)]);
    let sorterOk = true;
    sorterKeys.forEach(key => {
      const exV = excelSorter[key] || 0;
      const dbV = dbSorter[key] || 0;
      const status = exV === dbV ? '✅' : '❌';
      if (exV !== dbV) sorterOk = false;
      console.log(`  ${status} ${key}: Excel=${exV}, DB=${dbV}${exV !== dbV ? ' ← BEDA!' : ''}`);
    });
    if (sorterOk && sorterKeys.size > 0) console.log('  ✅ Semua data Sorter cocok!');

    // ── Compare PICKER ──────────────────────────────────────────────────────
    console.log('\n--- PICKER ---');
    const pickerKeys = new Set([...Object.keys(excelPicker), ...Object.keys(dbPicker)]);
    let pickerOk = true;
    pickerKeys.forEach(key => {
      const exV = excelPicker[key] || 0;
      const dbV = dbPicker[key] || 0;
      const status = exV === dbV ? '✅' : '❌';
      if (exV !== dbV) pickerOk = false;
      console.log(`  ${status} ${key}: Excel=${exV}, DB=${dbV}${exV !== dbV ? ' ← BEDA!' : ''}`);
    });
    if (pickerOk && pickerKeys.size > 0) console.log('  ✅ Semua data Picker cocok!');

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════');
    console.log('KESIMPULAN');
    console.log('════════════════════════════════════════');
    const totalDbLoader = Object.values(dbLoader).reduce((a, b) => a + b, 0);
    const totalDbSorter = Object.values(dbSorter).reduce((a, b) => a + b, 0);
    const totalDbPicker = Object.values(dbPicker).reduce((a, b) => a + b, 0);

    console.log(`Loader  → Excel: ${totalLoaderKont} kont | DB: ${totalDbLoader} kont ${totalLoaderKont === totalDbLoader ? '✅' : '❌ BEDA'}`);
    console.log(`Sorter  → Excel: ${totalSorterKont} kont | DB: ${totalDbSorter} kont ${totalSorterKont === totalDbSorter ? '✅' : '❌ BEDA'}`);
    console.log(`Picker  → Excel: ${totalPickerPcs} pcs  | DB: ${totalDbPicker} pcs  ${totalPickerPcs === totalDbPicker ? '✅' : '❌ BEDA'}`);

  } catch (err) {
    console.error('Error koneksi DB:', err.message);
  } finally {
    if (pool) await pool.end();
  }
}

compareWithDB();
