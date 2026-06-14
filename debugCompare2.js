const XLSX = require('xlsx');
const path = require('path');

const wb = XLSX.readFile(path.join(__dirname, 'Sheet ini.xlsx'));
const sheetName = 'Sorter'; // nama sheet yang tersedia
const ws = wb.Sheets[sheetName];
if (!ws) {
  console.log('Sheet tidak ditemukan. Sheet tersedia:', wb.SheetNames);
  process.exit(1);
}

const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Cari batch header rows
const batchHeaderRows = [];
for (let i = 0; i < raw.length; i++) {
  const rowStr = raw[i].join('|').toUpperCase();
  if (rowStr.includes('BATCH') && rowStr.match(/[A-Z]\d/)) {
    batchHeaderRows.push(i);
  }
}

console.log('Batch header rows:', batchHeaderRows);

for (const batchHeaderRowIdx of batchHeaderRows) {
  const batchCols = [];
  raw[batchHeaderRowIdx].forEach((cell, colIdx) => {
    const m = String(cell).trim().match(/^([A-Z0-9]+)\s+BATCH\s+(\d+)$/i);
    if (m) batchCols.push({ batchNum: m[2], batchName: String(cell).trim(), startCol: colIdx });
  });

  const dataStart = batchHeaderRowIdx + 2;

  // METODE LAMA: cek KONT > 0
  let oldSummaryRow = -1;
  for (let i = dataStart; i < Math.min(dataStart + 50, raw.length); i++) {
    const r = raw[i];
    const col0 = String(r[0]).trim();
    if (col0 === '' || col0 === '0') {
      const hasKont = batchCols.some(b => {
        const kontVal = parseInt(r[b.startCol + 3]);
        return !isNaN(kontVal) && kontVal > 0;
      });
      if (hasKont) { oldSummaryRow = i; break; }
    }
    if (/NAMA|SHIFT|TOT KONT/i.test(col0)) break;
  }

  // METODE BARU: cek RPS > 0
  let newSummaryRow = -1;
  for (let i = dataStart; i < Math.min(dataStart + 50, raw.length); i++) {
    const r = raw[i];
    const col0 = String(r[0]).trim();
    if (col0 === '' || col0 === '0') {
      const hasRps = batchCols.some(b => {
        const rpsVal = parseInt(r[b.startCol + 4]);
        return !isNaN(rpsVal) && rpsVal > 0;
      });
      if (hasRps) { newSummaryRow = i; break; }
    }
    if (/NAMA|SHIFT|TOT KONT/i.test(col0)) break;
  }

  console.log(`\n--- Grup batch header row ${batchHeaderRowIdx} ---`);
  console.log(`  OLD summary row: ${oldSummaryRow}, NEW summary row: ${newSummaryRow}`);

  batchCols.forEach(({ batchNum, batchName, startCol }) => {
    const oldVal = oldSummaryRow >= 0 ? (parseInt(raw[oldSummaryRow][startCol + 4]) || 0) : 'N/A';
    const newVal = newSummaryRow >= 0 ? (parseInt(raw[newSummaryRow][startCol + 4]) || 0) : 'N/A';
    
    // Fallback sum
    let fallbackSum = 0;
    for (let r = dataStart; r < (newSummaryRow >= 0 ? newSummaryRow : dataStart + 35); r++) {
      const no = raw[r][startCol];
      if (typeof no === 'number' && no > 0) fallbackSum += parseInt(raw[r][startCol + 4]) || 0;
    }
    
    console.log(`  Batch ${batchNum}: OLD=${oldVal} | NEW(fix)=${newVal} | fallback_sum=${fallbackSum}`);
  });
}
