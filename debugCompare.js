const XLSX = require('xlsx');
const path = require('path');

const wb = XLSX.readFile(path.join(__dirname, 'Sheet ini.xlsx'));

// Cari sheet Sorter
const sorterSheets = wb.SheetNames.filter(n => n.toLowerCase().includes('sorter'));
console.log('Sorter sheets:', sorterSheets);

sorterSheets.forEach(sheetName => {
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  console.log(`\n====== ${sheetName} ======`);

  // Cari baris TANGGAL CARIAN dan zona
  let tanggalRow = -1, tipeLokasi = '', zona = '';
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const row = data[r];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c]).toLowerCase();
      if (val.includes('tanggal carian')) {
        tanggalRow = r;
        // zona biasanya di kolom setelahnya
        for (let cc = c+1; cc < row.length; cc++) {
          if (row[cc] !== '') { 
            console.log(`  Tanggal Carian (Excel): ${row[cc]} → JS Date: ${new Date(Date.UTC(1899, 11, 30) + row[cc]*86400000).toISOString().slice(0,10)}`);
            break; 
          }
        }
      }
      if (val.includes('tipe') || val.includes('zona')) {
        zona = row[c+1] || '';
      }
    }
  }

  // Cari baris header batch (mengandung "BATCH")
  let batchHeaderRows = [];
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const rowStr = row.map(c => String(c)).join('|');
    if (rowStr.match(/BATCH\s*\d/i)) {
      batchHeaderRows.push(r);
    }
  }
  console.log('  Baris header BATCH ditemukan di row:', batchHeaderRows);

  // Untuk setiap header batch, cari kolom start dan baca nilai RPS
  batchHeaderRows.forEach(headerRow => {
    const row = data[headerRow];
    // Cari semua kolom yang mengandung "BATCH N"
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c]);
      const match = val.match(/BATCH\s*(\d+)/i);
      if (match) {
        const batchNum = match[1];
        // RPS ada di kolom startCol + 4
        const startCol = c;
        // Cari baris summary (sebelum NAMA SORTER)
        let summaryRow = -1;
        for (let r2 = headerRow + 1; r2 < data.length; r2++) {
          const rowBelow = data[r2];
          const rowStr = rowBelow.map(x => String(x).toUpperCase()).join('|');
          if (rowStr.includes('NAMA SORTER') || rowStr.includes('SHIFT') || rowStr.includes('TOT KONT')) {
            // Summary row adalah r2 - 1
            summaryRow = r2 - 1;
            break;
          }
        }
        if (summaryRow >= 0) {
          const summaryRowData = data[summaryRow];
          const rpsCol = startCol + 4;
          const kontCol = startCol + 3;
          const rpsVal = summaryRowData[rpsCol];
          const kontVal = summaryRowData[kontCol];
          console.log(`  Batch ${batchNum}: row=${summaryRow}, KONT col[${kontCol}]=${kontVal}, RPS col[${rpsCol}]=${rpsVal}`);
          
          // Juga print baris sekitar untuk verifikasi
          console.log(`    row[${summaryRow}] raw:`, summaryRowData.slice(startCol, startCol+6).join(' | '));
        } else {
          console.log(`  Batch ${batchNum}: summary row tidak ditemukan`);
        }
      }
    }
  });
});
