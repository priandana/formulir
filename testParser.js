// Test parser SS08 format dari file Excel nyata
require('dotenv').config();
const XLSX = require('xlsx');

const wb = XLSX.readFile('Sheet ini.xlsx');
const sheetNames = wb.SheetNames;
console.log('=== SS08 EXCEL PARSER TEST ===');
console.log('Sheets ditemukan:', sheetNames);

const records = [];
const skipped = [];
const info = [];

// --- PICKER ---
const pickerSheetName = sheetNames.find(n => n.toLowerCase().includes('picker'));
if (pickerSheetName) {
  console.log('\n[PICKER] Sheet:', pickerSheetName);
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
  console.log('  batchNameRow:', batchNameRowIdx, '| subTotalRow:', subTotalRowIdx);
  if (batchNameRowIdx !== -1 && subTotalRowIdx !== -1) {
    const batchNameRow = raw[batchNameRowIdx];
    const subTotalRow = raw[subTotalRowIdx];
    let count = 0;
    for (let col = 3; col < batchNameRow.length; col += 2) {
      let bh = '';
      for (let off = -1; off <= 2; off++) {
        const c = String(batchNameRow[col + off] || '').trim();
        if (c.toUpperCase().includes('BATCH')) { bh = c; break; }
      }
      const qty = parseInt(subTotalRow[col]);
      if (isNaN(qty) || qty <= 0 || !bh) continue;
      const m = bh.match(/^([A-Z0-9]+)\s+BATCH\s+(\d+)$/i);
      if (!m) { skipped.push(`Picker: format "${bh}" tidak dikenali`); continue; }
      console.log(`  ✅ zona=${m[1]}, batch=${m[2]}, qty=${qty} pcs`);
      records.push({ posisi: 'Picker', zona: m[1], batch: m[2], total_output: qty, satuan: 'pcs' });
      count++;
    }
    info.push(`Picker: ${count} batch`);
  }
}

// --- SORTER ---
const sorterSheetName = sheetNames.find(n => n.toLowerCase().includes('sort'));
if (sorterSheetName) {
  console.log('\n[SORTER] Sheet:', sorterSheetName);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sorterSheetName], { header: 1, defval: '' });
  let zonaVal = 'T1';
  for (let i = 0; i < 8; i++) {
    const rowStr = raw[i].join('|').toUpperCase();
    if (rowStr.includes('ZONA')) {
      for (let j = 0; j < raw[i].length; j++) {
        const v = String(raw[i][j]).trim();
        if (v && !v.toUpperCase().includes('ZONA') && !v.toUpperCase().includes('TYPE') && !v.toUpperCase().includes('TANGGAL')) { zonaVal = v; break; }
      }
      break;
    }
  }
  console.log('  Zona:', zonaVal);
  let batchHeaderRowIdx = -1;
  const batchTableCols = [];
  for (let i = 0; i < 10; i++) {
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
  const totKontRows = [];
  raw.forEach((row, i) => {
    if (String(row[0]).toUpperCase().includes('TOT') || String(row[1]).toUpperCase().includes('TOT')) totKontRows.push(i);
  });
  console.log('  batchTableCols:', batchTableCols.map(b => b.batchName).join(', '));
  console.log('  TOT KONT rows:', totKontRows.join(', '));
  const dataStartRow = batchHeaderRowIdx + 2;
  let sorterCount = 0;
  batchTableCols.forEach(({ batchNum, batchName, kontCol, startCol }, idx) => {
    const endRow = totKontRows[idx] !== undefined ? totKontRows[idx] : raw.length - 1;
    let totalKont = 0;
    for (let r = dataStartRow; r < endRow; r++) {
      const no = raw[r][startCol];
      if (typeof no === 'number' && no > 0) totalKont += parseInt(raw[r][kontCol]) || 0;
    }
    if (totalKont > 0) {
      console.log(`  ✅ zona=${zonaVal}, batch=${batchNum}, kont=${totalKont}`);
      records.push({ posisi: 'Sorter', zona: zonaVal, batch: batchNum, total_output: totalKont, satuan: 'kontainer' });
      sorterCount++;
    } else {
      console.log(`  ⚠️ ${batchName}: total = 0 (dilewati)`);
      skipped.push(`Sorter ${batchName}: total=0`);
    }
  });
  info.push(`Sorter: ${sorterCount} batch`);
}

// --- LOADER ---
const loaderSheetName = sheetNames.find(n => n.toLowerCase().includes('load') || n.toLowerCase().includes('kontainer'));
if (loaderSheetName) {
  console.log('\n[LOADER] Sheet:', loaderSheetName);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[loaderSheetName], { header: 1, defval: '' });
  const ZONES = ['F1', 'R1', 'R2', 'R3', 'T1', 'T2', 'T3', 'T4', 'T5'];
  let zoneHeaderRowIdx = -1;
  const zoneColMap = {};
  for (let i = 0; i < 15; i++) {
    const row = raw[i].map(c => String(c).trim().toUpperCase());
    if (ZONES.filter(z => row.includes(z)).length >= 3) {
      zoneHeaderRowIdx = i;
      ZONES.forEach(zone => {
        const idx = row.indexOf(zone);
        if (idx !== -1) zoneColMap[zone] = { batchCol: idx, kontCol: idx + 1 };
      });
      break;
    }
  }
  console.log('  Zone header row:', zoneHeaderRowIdx);
  console.log('  Zones found:', Object.keys(zoneColMap).join(', '));
  const dataStart = zoneHeaderRowIdx + 2;
  const agg = {};
  for (let r = dataStart; r < raw.length; r++) {
    const no = raw[r][0];
    if (typeof no !== 'number' || no <= 0 || !Number.isInteger(no)) continue;
    Object.entries(zoneColMap).forEach(([zone, { batchCol, kontCol }]) => {
      const bv = raw[r][batchCol];
      const kv = parseInt(raw[r][kontCol]) || 0;
      if (!bv || bv === 0 || bv === '' || kv <= 0) return;
      const key = `${zone}_${bv}`;
      agg[key] = (agg[key] || 0) + kv;
    });
  }
  let loaderCount = 0;
  Object.entries(agg).slice(0, 10).forEach(([key, total]) => {
    const [zona, ...bParts] = key.split('_');
    console.log(`  ✅ zona=${zona}, batch=${bParts.join('_')}, kont=${total}`);
    loaderCount++;
  });
  if (Object.keys(agg).length > 10) console.log(`  ... dan ${Object.keys(agg).length - 10} lainnya`);
  info.push(`Loader: ${Object.keys(agg).length} kombinasi zona+batch`);
}

console.log('\n=== HASIL ===');
console.log('Total records:', records.length);
console.log('Info:', info.join(', '));
console.log('Skipped:', skipped.length);
