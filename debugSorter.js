require('dotenv').config();
const XLSX = require('xlsx');
const wb = XLSX.readFile('Sheet ini.xlsx');

const sorter = XLSX.utils.sheet_to_json(wb.Sheets['Sorter'], { header: 1, defval: '' });

// Print baris 6-9 (header area)
console.log('=== HEADER ROWS 6-9 ===');
for (let i = 5; i <= 8; i++) {
  console.log(`Row ${i+1}:`, JSON.stringify(sorter[i]));
}

// Print row TOT KONT dan beberapa baris di atasnya
console.log('\n=== AREA SEKITAR TOT KONT (row 41) ===');
for (let i = 36; i <= 42; i++) {
  console.log(`Row ${i+1}:`, JSON.stringify(sorter[i]));
}

// Print baris data awal (row 8-15)
console.log('\n=== BARIS DATA AWAL (row 8-15) ===');
for (let i = 7; i <= 14; i++) {
  console.log(`Row ${i+1}:`, JSON.stringify(sorter[i]));
}
