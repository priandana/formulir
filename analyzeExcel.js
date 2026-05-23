require('dotenv').config();
const XLSX = require('xlsx');
const wb = XLSX.readFile('Sheet ini.xlsx');

// === SORTER: Get actual TOT KONT values ===
console.log('=== SORTER: TOT KONT VALUES ===');
const sorter = XLSX.utils.sheet_to_json(wb.Sheets['Sorter'], { header: 1, defval: '' });
const zona = sorter[3][3]; // TYPE ZONA value
const batchHeaders = sorter[5]; // Row 6: T1 BATCH 1, T1 BATCH 2...
console.log('Zona:', zona);

// TOT KONT rows: 41, 78, 115, 152, 189 (1-indexed)
const totKontRows = [40, 77, 114, 151, 188]; // 0-indexed
totKontRows.forEach((rowIdx, batchNum) => {
  const row = sorter[rowIdx];
  console.log(`\nBATCH ${batchNum + 1} (row ${rowIdx + 1}):`);
  row.forEach((val, colIdx) => {
    if (val !== '') console.log(`  col ${colIdx}: ${JSON.stringify(val)}`);
  });
});

// === LOADER: Understand structure ===
console.log('\n\n=== LOADER: STRUCTURE ===');
const loader = XLSX.utils.sheet_to_json(wb.Sheets['Loader'], { header: 1, defval: '' });

// Zone column mapping from row 8 (index 7)
const zoneRow = loader[7];
const batchKontRow = loader[8];
console.log('Zone row (7):', JSON.stringify(zoneRow));
console.log('BatchKont row (8):', JSON.stringify(batchKontRow));

// Sample data rows
console.log('\nSample data rows 10-13:');
for (let i = 9; i < 13; i++) {
  console.log(`Row ${i+1}:`, JSON.stringify(loader[i]));
}

// Look at B03 Total row more carefully
console.log('\nB03 Total row (39):', JSON.stringify(loader[38]));
console.log('B06 Total row (70):', JSON.stringify(loader[69]));

// Find all "Total" rows and look at their data
console.log('\nAll Total rows (first 5):');
let count = 0;
loader.forEach((row, i) => {
  if (count >= 5) return;
  const rowStr = row.join('|');
  if (rowStr.includes('Total') && !rowStr.includes('Grand')) {
    console.log(`Row ${i+1}:`, JSON.stringify(row));
    count++;
  }
});
