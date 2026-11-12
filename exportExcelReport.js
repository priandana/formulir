const ExcelJS = require('exceljs');

const FONT_NAME = 'Calibri';

const COLORS = {
  navy:        'FF0F294A',
  navyMid:     'FF1E3A8A',
  royalBlue:   'FF2563EB',
  emerald:     'FF047857',
  teal:        'FF0F766E',
  slateDark:   'FF334155',
  white:       'FFFFFFFF',
  bannerSubBg: 'FFEFF6FF',
  bannerSubFg: 'FF1E40AF',
  zebraEven:   'FFFFFFFF',
  zebraOdd:    'FFF8FAFC',
  totalBg:     'FFE2E8F0',
  totalFg:     'FF0F172A',
  borderLight: 'FFE2E8F0',
  borderMed:   'FFCBD5E1',
  mutedText:   'FF94A3B8',
  bodyText:    'FF1E293B',
  pickerBg:    'FFDBEAFE',
  pickerFg:    'FF1E40AF',
  sorterBg:    'FFDCFCE7',
  sorterFg:    'FF166534',
  loaderBg:    'FFFEF3C7',
  loaderFg:    'FF92400E',
  returnBg:    'FFEDE9FE',
  returnFg:    'FF5B21B6',
  approvedBg:  'FFDCFCE7',
  approvedFg:  'FF166534',
  pendingBg:   'FFFEF3C7',
  pendingFg:   'FF92400E',
  rejectedBg:  'FFFEE2E2',
  rejectedFg:  'FF991B1B',
};

const BORDER_THIN = {
  top:    { style: 'thin', color: { argb: COLORS.borderLight } },
  left:   { style: 'thin', color: { argb: COLORS.borderLight } },
  bottom: { style: 'thin', color: { argb: COLORS.borderLight } },
  right:  { style: 'thin', color: { argb: COLORS.borderLight } },
};

const BORDER_TOTAL = {
  top:    { style: 'thin',   color: { argb: COLORS.navyMid } },
  bottom: { style: 'double', color: { argb: COLORS.navyMid } },
  left:   { style: 'thin',   color: { argb: COLORS.borderMed } },
  right:  { style: 'thin',   color: { argb: COLORS.borderMed } },
};

function parseBatches(batchCluster) {
  if (!batchCluster) return [];
  if (Array.isArray(batchCluster)) return batchCluster;
  try {
    const parsed = JSON.parse(batchCluster);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch (e) {
    return String(batchCluster)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
}

function formatMonthLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || 'Lainnya';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

function formatIndoDate(isoStr) {
  if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return isoStr || '-';
  const [y, m, d] = isoStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function colLetter(colIdx) {
  let n = colIdx;
  let str = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    str = String.fromCharCode(65 + rem) + str;
    n = Math.floor((n - 1) / 26);
  }
  return str;
}

function getPosisiStyle(posisi) {
  const p = String(posisi || '').toLowerCase();
  if (p === 'picker') return { bg: COLORS.pickerBg, fg: COLORS.pickerFg };
  if (p === 'sorter') return { bg: COLORS.sorterBg, fg: COLORS.sorterFg };
  if (p === 'loader') return { bg: COLORS.loaderBg, fg: COLORS.loaderFg };
  if (p === 'return') return { bg: COLORS.returnBg, fg: COLORS.returnFg };
  return { bg: COLORS.zebraOdd, fg: COLORS.bodyText };
}

function getStatusStyle(status) {
  const s = String(status || 'approved').toLowerCase();
  if (s === 'pending')  return { bg: COLORS.pendingBg,  fg: COLORS.pendingFg,  label: 'Pending' };
  if (s === 'rejected') return { bg: COLORS.rejectedBg, fg: COLORS.rejectedFg, label: 'Rejected' };
  return { bg: COLORS.approvedBg, fg: COLORS.approvedFg, label: 'Approved' };
}

function applyBanner(sheet, totalCols, title, subtitle) {
  const endCol = colLetter(totalCols);
  sheet.mergeCells(`A1:${endCol}1`);
  sheet.mergeCells(`A2:${endCol}2`);

  const r1 = sheet.getRow(1);
  const c1 = r1.getCell(1);
  c1.value = title;
  c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  c1.font = { name: FONT_NAME, size: 14, bold: true, color: { argb: COLORS.white } };
  c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  r1.height = 30;

  const r2 = sheet.getRow(2);
  const c2 = r2.getCell(1);
  c2.value = subtitle;
  c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bannerSubBg } };
  c2.font = { name: FONT_NAME, size: 10, italic: true, color: { argb: COLORS.bannerSubFg } };
  c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  c2.border = { bottom: { style: 'medium', color: { argb: COLORS.royalBlue } } };
  r2.height = 22;
}

function applyPrintSetup(sheet, landscape = true) {
  sheet.pageSetup = {
    paperSize: 9, // A4
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  };
}

function autoFitColumns(sheet, colConfigs, extraPad = 4) {
  colConfigs.forEach((cfg, idx) => {
    const col = sheet.getColumn(idx + 1);
    const headerLen = String(cfg.header || '').length + (cfg.hasFilter ? 5 : 2);
    let maxLen = Math.max(cfg.minWidth || 8, headerLen);

    const startRow = cfg.scanFromRow || 1;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber < startRow) return;
      const cell = row.getCell(idx + 1);
      if (cell.isMerged) return;
      const v = cell.value;
      if (v === null || v === undefined) return;
      let text = '';
      if (typeof v === 'object' && v.formula !== undefined) {
        text = String(v.result !== undefined ? v.result : '000,000');
      } else if (typeof v === 'number') {
        text = v.toLocaleString('id-ID');
      } else {
        text = String(v);
      }
      if (text.length > maxLen) maxLen = text.length;
    });

    const maxCap = cfg.maxWidth || 44;
    col.width = Math.min(maxCap, maxLen + extraPad);
  });
}

function buildPeriodLabel(query, submissions) {
  const { tanggal_mulai, tanggal_akhir } = query || {};
  if (tanggal_mulai && tanggal_akhir) {
    return `${formatIndoDate(tanggal_mulai)} s/d ${formatIndoDate(tanggal_akhir)}`;
  }
  if (tanggal_mulai) return `Mulai ${formatIndoDate(tanggal_mulai)}`;
  if (tanggal_akhir) return `Sampai ${formatIndoDate(tanggal_akhir)}`;

  const dates = submissions.map(s => s.tanggal_carian).filter(Boolean).sort();
  if (dates.length > 0) {
    const first = dates[0];
    const last = dates[dates.length - 1];
    return first === last
      ? formatIndoDate(first)
      : `${formatIndoDate(first)} s/d ${formatIndoDate(last)} (Semua Data)`;
  }
  return 'Semua Periode';
}

function buildFilterSummaryText(query) {
  const parts = [];
  if (query.posisi && query.posisi !== 'semua' && query.posisi !== 'all') parts.push(`Posisi: ${query.posisi}`);
  if (query.zona && query.zona !== 'semua' && query.zona !== 'all') parts.push(`Zona: ${query.zona}`);
  if (query.status && query.status !== 'semua' && query.status !== 'all') parts.push(`Status: ${query.status}`);
  return parts.length ? parts.join(' • ') : 'Semua Posisi, Zona & Status';
}

function aggregateReportData(submissions, users) {
  const userInfoMap = {};
  (users || []).forEach(u => {
    const key = String(u.nama_lengkap || u.username || '').toLowerCase().trim();
    if (key) {
      userInfoMap[key] = {
        nik: u.nik || '-',
        tipe_karyawan: u.tipe_karyawan || 'Productivity',
        posisi_master: u.posisi || '-',
      };
    }
  });

  const allDatesSet = new Set();
  const allEmployeesSet = new Set();
  const monthsSet = new Set();

  let totalInputAll = 0;
  let totalApproved = 0;
  let totalPending = 0;
  let totalRejected = 0;
  let totalOutputValid = 0;
  let totalBatchValid = 0;

  const byPosisi = {};
  const byZona = {};
  const byEmployeeRole = {}; // key: namaKey|||posisi

  submissions.forEach(s => {
    totalInputAll++;
    const status = String(s.status || 'approved').toLowerCase();
    if (status === 'approved') totalApproved++;
    else if (status === 'pending') totalPending++;
    else if (status === 'rejected') totalRejected++;

    const namaDisplay = String(s.nama || '-').trim();
    const namaKey = namaDisplay.toLowerCase();
    const posisi = String(s.posisi || '-').trim();
    const zona = String(s.zona || '-').trim();
    const tipeLokasi = String(s.tipe_lokasi || '-').trim();
    const tgl = s.tanggal_carian ? String(s.tanggal_carian).slice(0, 10) : '';
    const monthKey = tgl && tgl.length >= 7 ? tgl.slice(0, 7) : 'Lainnya';
    const batches = parseBatches(s.batch_cluster);
    const batchCount = batches.length;
    const output = Number(s.jumlah_output) || 0;
    const uInfo = userInfoMap[namaKey] || { nik: '-', tipe_karyawan: 'Belum Ditentukan' };

    const empKey = `${namaKey}|||${posisi}`;
    if (!byEmployeeRole[empKey]) {
      byEmployeeRole[empKey] = {
        nama: namaDisplay,
        nik: uInfo.nik,
        tipe_karyawan: uInfo.tipe_karyawan,
        posisi,
        validDays: new Set(),
        validInputs: 0,
        totalBatch: 0,
        totalOutput: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        months: {}, // monthKey -> { days: Set, inputs: 0, output: 0, batches: 0 }
      };
    }
    const emp = byEmployeeRole[empKey];
    if (status === 'approved') emp.approved++;
    else if (status === 'pending') emp.pending++;
    else if (status === 'rejected') emp.rejected++;

    if (status !== 'rejected') {
      totalOutputValid += output;
      totalBatchValid += batchCount;
      if (tgl) allDatesSet.add(tgl);
      if (namaKey) allEmployeesSet.add(namaKey);
      if (monthKey) monthsSet.add(monthKey);

      emp.validInputs++;
      emp.totalBatch += batchCount;
      emp.totalOutput += output;
      if (tgl) emp.validDays.add(tgl);

      if (!emp.months[monthKey]) {
        emp.months[monthKey] = { days: new Set(), inputs: 0, output: 0, batches: 0 };
      }
      emp.months[monthKey].inputs++;
      emp.months[monthKey].output += output;
      emp.months[monthKey].batches += batchCount;
      if (tgl) emp.months[monthKey].days.add(tgl);

      // By Posisi
      if (!byPosisi[posisi]) {
        byPosisi[posisi] = { posisi, employees: new Set(), days: new Set(), inputs: 0, batches: 0, output: 0 };
      }
      byPosisi[posisi].employees.add(namaKey);
      if (tgl) byPosisi[posisi].days.add(tgl);
      byPosisi[posisi].inputs++;
      byPosisi[posisi].batches += batchCount;
      byPosisi[posisi].output += output;

      // By Zona
      const zonaKey = `${tipeLokasi}|||${zona}|||${posisi}`;
      if (!byZona[zonaKey]) {
        byZona[zonaKey] = { tipeLokasi, zona, posisi, employees: new Set(), inputs: 0, batches: 0, output: 0 };
      }
      byZona[zonaKey].employees.add(namaKey);
      byZona[zonaKey].inputs++;
      byZona[zonaKey].batches += batchCount;
      byZona[zonaKey].output += output;
    }
  });

  const sortedMonths = [...monthsSet].sort();
  const employeeList = Object.values(byEmployeeRole).sort((a, b) =>
    b.totalOutput - a.totalOutput || b.validInputs - a.validInputs || a.nama.localeCompare(b.nama)
  );
  const posisiList = Object.values(byPosisi).sort((a, b) => b.output - a.output);
  const zonaList = Object.values(byZona).sort((a, b) =>
    a.posisi.localeCompare(b.posisi) || a.zona.localeCompare(b.zona)
  );

  return {
    userInfoMap,
    totalInputAll,
    totalApproved,
    totalPending,
    totalRejected,
    totalOutputValid,
    totalBatchValid,
    activeDaysCount: allDatesSet.size,
    activeEmployeesCount: allEmployeesSet.size,
    sortedMonths,
    employeeList,
    posisiList,
    zonaList,
  };
}

function buildExecutiveSheet(workbook, data, meta) {
  const ws = workbook.addWorksheet('Ringkasan Eksekutif', {
    properties: { tabColor: { argb: COLORS.navyMid } },
    views: [{ showGridLines: true }],
  });

  applyBanner(
    ws,
    9,
    'LAPORAN PENCAPAIAN KINERJA OPERASIONAL — DC SS08',
    `Periode: ${meta.periodLabel}   |   Filter: ${meta.filterText}   |   Dicetak: ${meta.printedAt}`
  );

  // Spacer
  ws.getRow(3).height = 10;

  // ===== KPI CARDS (Rows 4-6, 4 cards across cols A-B, C-D, E-F, G-I) =====
  const approvalRate = data.totalInputAll > 0 ? data.totalApproved / data.totalInputAll : 0;
  const kpis = [
    { start: 1, end: 2, label: 'KARYAWAN AKTIF INPUT', value: `${data.activeEmployeesCount.toLocaleString('id-ID')} Orang`, sub: `${data.activeDaysCount} Hari Kerja Tercatat`, accent: COLORS.royalBlue, bg: 'FFEFF6FF' },
    { start: 3, end: 4, label: 'TOTAL INPUT / ENTRI',  value: `${data.totalInputAll.toLocaleString('id-ID')} Entri`, sub: `Approved: ${data.totalApproved} • Pending: ${data.totalPending} • Rejected: ${data.totalRejected}`, accent: 'FF4F46E5', bg: 'FFEEF2FF' },
    { start: 5, end: 6, label: 'TOTAL OUTPUT (VALID)', value: data.totalOutputValid.toLocaleString('id-ID'), sub: `Total Batch Dikerjakan: ${data.totalBatchValid.toLocaleString('id-ID')}`, accent: COLORS.emerald, bg: 'FFECFDF5' },
    { start: 7, end: 9, label: 'TINGKAT APPROVAL',     value: `${(approvalRate * 100).toFixed(1)}%`, sub: `Rata2 Valid: ${(data.activeDaysCount ? data.totalOutputValid / data.activeDaysCount : 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })} Output / Hari`, accent: 'FFD97706', bg: 'FFFFFBEB' },
  ];

  ws.getRow(4).height = 18;
  ws.getRow(5).height = 28;
  ws.getRow(6).height = 18;

  kpis.forEach(k => {
    const cStart = colLetter(k.start);
    const cEnd = colLetter(k.end);
    ws.mergeCells(`${cStart}4:${cEnd}4`);
    ws.mergeCells(`${cStart}5:${cEnd}5`);
    ws.mergeCells(`${cStart}6:${cEnd}6`);

    for (let r = 4; r <= 6; r++) {
      for (let c = k.start; c <= k.end; c++) {
        const cell = ws.getRow(r).getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: k.bg } };
        cell.border = {
          top:    r === 4 ? { style: 'medium', color: { argb: k.accent } } : undefined,
          bottom: r === 6 ? { style: 'thin',   color: { argb: COLORS.borderMed } } : undefined,
          left:   c === k.start ? { style: 'thin', color: { argb: COLORS.borderMed } } : undefined,
          right:  c === k.end   ? { style: 'thin', color: { argb: COLORS.borderMed } } : undefined,
        };
      }
    }

    const lblCell = ws.getRow(4).getCell(k.start);
    lblCell.value = k.label;
    lblCell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: k.accent } };
    lblCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const valCell = ws.getRow(5).getCell(k.start);
    valCell.value = k.value;
    valCell.font = { name: FONT_NAME, size: 16, bold: true, color: { argb: COLORS.navy } };
    valCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const subCell = ws.getRow(6).getCell(k.start);
    subCell.value = k.sub;
    subCell.font = { name: FONT_NAME, size: 9, color: { argb: COLORS.slateDark } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  let curRow = 8;

  // Helper to render section title
  const addSectionTitle = (text, colsCount) => {
    ws.mergeCells(`A${curRow}:${colLetter(colsCount)}${curRow}`);
    const r = ws.getRow(curRow);
    const c = r.getCell(1);
    c.value = text;
    c.font = { name: FONT_NAME, size: 11, bold: true, color: { argb: COLORS.navyMid } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    c.border = { left: { style: 'thick', color: { argb: COLORS.royalBlue } }, bottom: { style: 'thin', color: { argb: COLORS.borderMed } } };
    r.height = 24;
    curRow++;
  };

  // ===== SECTION 1: RINGKASAN PER POSISI =====
  addSectionTitle('A. RINGKASAN PENCAPAIAN PER POSISI', 9);
  const posHeaders = ['No', 'Posisi', 'Jml Karyawan', 'Hari Aktif', 'Jml Input', 'Total Batch', 'Total Output', 'Rata2 / Input', 'Kontribusi (%)'];
  const posHeaderRow = ws.getRow(curRow);
  posHeaders.forEach((h, i) => {
    const cell = posHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyMid } };
    cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER_THIN;
  });
  posHeaderRow.height = 22;
  curRow++;

  if (data.posisiList.length === 0) {
    ws.mergeCells(`A${curRow}:I${curRow}`);
    ws.getRow(curRow).getCell(1).value = 'Tidak ada data valid (non-rejected) pada periode ini.';
    ws.getRow(curRow).getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    curRow++;
  } else {
    data.posisiList.forEach((p, idx) => {
      const r = ws.getRow(curRow);
      const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
      const contrib = data.totalOutputValid > 0 ? p.output / data.totalOutputValid : 0;
      const avgInput = p.inputs > 0 ? p.output / p.inputs : 0;
      const vals = [idx + 1, p.posisi, p.employees.size, p.days.size, p.inputs, p.batches, p.output, avgInput, contrib];
      vals.forEach((v, cIdx) => {
        const cell = r.getCell(cIdx + 1);
        cell.value = v;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = { name: FONT_NAME, size: 10, color: { argb: COLORS.bodyText } };
        cell.border = BORDER_THIN;
        cell.alignment = { vertical: 'middle', horizontal: cIdx <= 1 ? 'center' : 'right' };
      });
      const posBadge = getPosisiStyle(p.posisi);
      r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posBadge.bg } };
      r.getCell(2).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: posBadge.fg } };
      r.getCell(3).numFmt = '#,##0';
      r.getCell(4).numFmt = '#,##0';
      r.getCell(5).numFmt = '#,##0';
      r.getCell(6).numFmt = '#,##0';
      r.getCell(7).numFmt = '#,##0';
      r.getCell(7).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.navy } };
      r.getCell(8).numFmt = '#,##0.0';
      r.getCell(9).numFmt = '0.0%';
      r.height = 20;
      curRow++;
    });

    // Total Row Posisi
    const totR = ws.getRow(curRow);
    const totVals = ['TOTAL', '', data.activeEmployeesCount, data.activeDaysCount, data.posisiList.reduce((s, x) => s + x.inputs, 0), data.totalBatchValid, data.totalOutputValid, data.totalInputAll > 0 ? data.totalOutputValid / data.posisiList.reduce((s, x) => s + x.inputs, 0) : 0, 1];
    totVals.forEach((v, cIdx) => {
      const cell = totR.getCell(cIdx + 1);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
      cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.totalFg } };
      cell.border = BORDER_TOTAL;
      cell.alignment = { vertical: 'middle', horizontal: cIdx <= 1 ? 'center' : 'right' };
    });
    ws.mergeCells(`A${curRow}:B${curRow}`);
    totR.getCell(3).numFmt = '#,##0';
    totR.getCell(4).numFmt = '#,##0';
    totR.getCell(5).numFmt = '#,##0';
    totR.getCell(6).numFmt = '#,##0';
    totR.getCell(7).numFmt = '#,##0';
    totR.getCell(8).numFmt = '#,##0.0';
    totR.getCell(9).numFmt = '0.0%';
    totR.height = 22;
    curRow++;
  }

  curRow += 1;

  // ===== SECTION 2: TOP 10 KARYAWAN OUTPUT TERTINGGI =====
  addSectionTitle('B. TOP 10 KARYAWAN OUTPUT TERTINGGI (VALID / NON-REJECTED)', 9);
  const topHeaders = ['Rank', 'Nama Karyawan', 'NIK', 'Tipe', 'Posisi', 'Hari Aktif', 'Jml Input', 'Total Output', 'Rata2 / Hari'];
  const topHeaderRow = ws.getRow(curRow);
  topHeaders.forEach((h, i) => {
    const cell = topHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.emerald } };
    cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER_THIN;
  });
  topHeaderRow.height = 22;
  curRow++;

  const top10 = data.employeeList.filter(e => e.validInputs > 0).slice(0, 10);
  if (top10.length === 0) {
    ws.mergeCells(`A${curRow}:I${curRow}`);
    ws.getRow(curRow).getCell(1).value = 'Belum ada karyawan dengan entri valid.';
    ws.getRow(curRow).getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    curRow++;
  } else {
    top10.forEach((e, idx) => {
      const r = ws.getRow(curRow);
      const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
      const daysCount = e.validDays.size;
      const avgDay = daysCount > 0 ? e.totalOutput / daysCount : 0;
      const vals = [idx + 1, e.nama, e.nik, e.tipe_karyawan, e.posisi, daysCount, e.validInputs, e.totalOutput, avgDay];
      vals.forEach((v, cIdx) => {
        const cell = r.getCell(cIdx + 1);
        cell.value = v;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = { name: FONT_NAME, size: 10, color: { argb: COLORS.bodyText } };
        cell.border = BORDER_THIN;
        if (cIdx === 0 || cIdx === 2 || cIdx === 3 || cIdx === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (cIdx === 1) {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        }
      });
      const posBadge = getPosisiStyle(e.posisi);
      r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posBadge.bg } };
      r.getCell(5).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: posBadge.fg } };
      r.getCell(1).font = { name: FONT_NAME, size: 10, bold: idx < 3, color: { argb: idx < 3 ? COLORS.navyMid : COLORS.bodyText } };
      r.getCell(2).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.bodyText } };
      r.getCell(6).numFmt = '#,##0';
      r.getCell(7).numFmt = '#,##0';
      r.getCell(8).numFmt = '#,##0';
      r.getCell(8).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.emerald } };
      r.getCell(9).numFmt = '#,##0.0';
      r.height = 20;
      curRow++;
    });
  }

  curRow += 1;

  // ===== SECTION 3: RINGKASAN PER ZONA & TIPE LOKASI =====
  addSectionTitle('C. RINGKASAN DISTRIBUSI PER ZONA & TIPE LOKASI', 9);
  const zonaHeaders = ['No', 'Posisi', 'Tipe Lokasi', 'Zona', 'Jml Karyawan', 'Jml Input', 'Total Batch', 'Total Output', 'Kontribusi (%)'];
  const zHeaderRow = ws.getRow(curRow);
  zonaHeaders.forEach((h, i) => {
    const cell = zHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateDark } };
    cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER_THIN;
  });
  zHeaderRow.height = 22;
  curRow++;

  data.zonaList.forEach((z, idx) => {
    const r = ws.getRow(curRow);
    const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
    const contrib = data.totalOutputValid > 0 ? z.output / data.totalOutputValid : 0;
    const vals = [idx + 1, z.posisi, z.tipeLokasi, z.zona, z.employees.size, z.inputs, z.batches, z.output, contrib];
    vals.forEach((v, cIdx) => {
      const cell = r.getCell(cIdx + 1);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { name: FONT_NAME, size: 10, color: { argb: COLORS.bodyText } };
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: 'middle', horizontal: cIdx <= 3 ? 'center' : 'right' };
    });
    const posBadge = getPosisiStyle(z.posisi);
    r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posBadge.bg } };
    r.getCell(2).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: posBadge.fg } };
    r.getCell(5).numFmt = '#,##0';
    r.getCell(6).numFmt = '#,##0';
    r.getCell(7).numFmt = '#,##0';
    r.getCell(8).numFmt = '#,##0';
    r.getCell(8).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.navy } };
    r.getCell(9).numFmt = '0.0%';
    r.height = 20;
    curRow++;
  });

  // Set clean column widths for Executive Sheet
  const widths = [8, 28, 16, 16, 15, 14, 15, 16, 16];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  applyPrintSetup(ws, true);
}

function buildEmployeeSummarySheet(workbook, data, meta) {
  const ws = workbook.addWorksheet('Rekap Per Karyawan', {
    properties: { tabColor: { argb: COLORS.royalBlue } },
    views: [{ state: 'frozen', ySplit: 4, xSplit: 2, showGridLines: true }],
  });

  const cols = [
    { header: 'No',               minWidth: 7,  hasFilter: true },
    { header: 'Nama Karyawan',    minWidth: 26, hasFilter: true },
    { header: 'NIK',              minWidth: 14, hasFilter: true },
    { header: 'Tipe Karyawan',    minWidth: 16, hasFilter: true },
    { header: 'Posisi',           minWidth: 13, hasFilter: true },
    { header: 'Hari Aktif',       minWidth: 13, hasFilter: true },
    { header: 'Jml Input Valid',  minWidth: 16, hasFilter: true },
    { header: 'Total Batch',      minWidth: 14, hasFilter: true },
    { header: 'Total Output',     minWidth: 16, hasFilter: true },
    { header: 'Rata2 / Hari',     minWidth: 15, hasFilter: true },
    { header: 'Rata2 / Input',    minWidth: 15, hasFilter: true },
    { header: 'Kontribusi (%)',   minWidth: 16, hasFilter: true },
    { header: 'Approved',         minWidth: 13, hasFilter: true },
    { header: 'Pending',          minWidth: 12, hasFilter: true },
    { header: 'Rejected',         minWidth: 13, hasFilter: true },
  ];

  applyBanner(
    ws,
    cols.length,
    'REKAP PENCAPAIAN PER KARYAWAN — DC SS08',
    `Periode: ${meta.periodLabel}   |   Diurutkan berdasarkan Total Output tertinggi (Output dihitung dari status non-Rejected)`
  );
  ws.getRow(3).height = 8;

  const headerRow = ws.getRow(4);
  cols.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = c.header;
    const isOutputCol = idx === 8;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isOutputCol ? COLORS.emerald : COLORS.navyMid } };
    cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER_THIN;
  });
  headerRow.height = 25;

  const startDataRow = 5;
  data.employeeList.forEach((e, idx) => {
    const rowNum = startDataRow + idx;
    const r = ws.getRow(rowNum);
    const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;
    const daysCount = e.validDays.size;
    const avgDay = daysCount > 0 ? e.totalOutput / daysCount : 0;
    const avgInput = e.validInputs > 0 ? e.totalOutput / e.validInputs : 0;
    const contrib = data.totalOutputValid > 0 ? e.totalOutput / data.totalOutputValid : 0;

    const vals = [
      idx + 1,
      e.nama,
      e.nik,
      e.tipe_karyawan,
      e.posisi,
      daysCount,
      e.validInputs,
      e.totalBatch,
      e.totalOutput,
      avgDay,
      avgInput,
      contrib,
      e.approved,
      e.pending,
      e.rejected,
    ];

    vals.forEach((v, cIdx) => {
      const cell = r.getCell(cIdx + 1);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { name: FONT_NAME, size: 10, color: { argb: COLORS.bodyText } };
      cell.border = BORDER_THIN;
      if (cIdx === 0 || cIdx === 2 || cIdx === 3 || cIdx === 4) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (cIdx === 1) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      }
    });

    r.getCell(2).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.bodyText } };
    const posStyle = getPosisiStyle(e.posisi);
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posStyle.bg } };
    r.getCell(5).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: posStyle.fg } };

    [6, 7, 8, 9, 13, 14, 15].forEach(colIdx => { r.getCell(colIdx).numFmt = '#,##0'; });
    r.getCell(9).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.emerald } };
    r.getCell(10).numFmt = '#,##0.0';
    r.getCell(11).numFmt = '#,##0.0';
    r.getCell(12).numFmt = '0.0%';
    if (e.pending > 0) r.getCell(14).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.pendingFg } };
    if (e.rejected > 0) r.getCell(15).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.rejectedFg } };
    r.height = 20;
  });

  if (data.employeeList.length > 0) {
    const endDataRow = startDataRow + data.employeeList.length - 1;
    const totalRowNum = endDataRow + 1;
    const totR = ws.getRow(totalRowNum);
    ws.mergeCells(`A${totalRowNum}:E${totalRowNum}`);

    for (let c = 1; c <= cols.length; c++) {
      const cell = totR.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
      cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.totalFg } };
      cell.border = BORDER_TOTAL;
      cell.alignment = { vertical: 'middle', horizontal: c <= 5 ? 'center' : 'right' };
    }
    totR.getCell(1).value = `GRAND TOTAL (${data.employeeList.length} Baris)`;
    totR.getCell(6).value = data.activeDaysCount;
    totR.getCell(6).numFmt = '#,##0';
    [7, 8, 9, 13, 14, 15].forEach(c => {
      const l = colLetter(c);
      totR.getCell(c).value = { formula: `SUM(${l}${startDataRow}:${l}${endDataRow})` };
      totR.getCell(c).numFmt = '#,##0';
    });
    totR.getCell(10).value = { formula: `IF(F${totalRowNum}>0,I${totalRowNum}/F${totalRowNum},0)` };
    totR.getCell(10).numFmt = '#,##0.0';
    totR.getCell(11).value = { formula: `IF(G${totalRowNum}>0,I${totalRowNum}/G${totalRowNum},0)` };
    totR.getCell(11).numFmt = '#,##0.0';
    totR.getCell(12).value = { formula: `SUM(L${startDataRow}:L${endDataRow})` };
    totR.getCell(12).numFmt = '0.0%';
    totR.height = 23;

    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to:   { row: endDataRow, column: cols.length },
    };
  }

  autoFitColumns(ws, cols.map(c => ({ ...c, scanFromRow: 4 })), 3);
  applyPrintSetup(ws, true);
}

function buildMonthlyPerPersonSheet(workbook, data, meta) {
  const ws = workbook.addWorksheet('Rekap Bulanan Per Orang', {
    properties: { tabColor: { argb: COLORS.emerald } },
    views: [{ state: 'frozen', ySplit: 5, xSplit: 5, showGridLines: true }],
  });

  const months = data.sortedMonths.length > 0 ? data.sortedMonths : ['Periode'];
  const fixedCols = [
    { header: 'No',            minWidth: 7 },
    { header: 'Nama Karyawan', minWidth: 26 },
    { header: 'NIK',           minWidth: 14 },
    { header: 'Tipe',          minWidth: 15 },
    { header: 'Posisi',        minWidth: 12 },
  ];

  // Each month has 3 columns: Hari Aktif, Jml Input, Total Output
  // Right summary has 4 columns: Hari Aktif, Total Input, Total Output, Rata2/Input
  const totalCols = fixedCols.length + months.length * 3 + 4;

  applyBanner(
    ws,
    totalCols,
    'MATRIKS INPUT & OUTPUT BULANAN PER KARYAWAN — DC SS08',
    `Periode: ${meta.periodLabel}   |   Menampilkan jumlah hari aktif, berapa kali input, & total output per orang setiap bulan`
  );
  ws.getRow(3).height = 8;

  const rGroup = ws.getRow(4);
  const rSub   = ws.getRow(5);
  rGroup.height = 22;
  rSub.height = 21;

  // Fixed left headers merged vertically across rows 4-5
  fixedCols.forEach((fc, idx) => {
    const colL = colLetter(idx + 1);
    ws.mergeCells(`${colL}4:${colL}5`);
    [4, 5].forEach(rn => {
      const cell = ws.getRow(rn).getCell(idx + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyMid } };
      cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = BORDER_THIN;
    });
    rGroup.getCell(idx + 1).value = fc.header;
  });

  // Dynamic month groups
  const monthColors = [COLORS.emerald, COLORS.teal, 'FF0369A1', 'FF4338CA'];
  let curCol = fixedCols.length + 1;

  months.forEach((m, mIdx) => {
    const startL = colLetter(curCol);
    const endL   = colLetter(curCol + 2);
    const mColor = monthColors[mIdx % monthColors.length];
    ws.mergeCells(`${startL}4:${endL}4`);

    for (let c = curCol; c <= curCol + 2; c++) {
      const topCell = rGroup.getCell(c);
      topCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: mColor } };
      topCell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
      topCell.alignment = { vertical: 'middle', horizontal: 'center' };
      topCell.border = BORDER_THIN;
    }
    rGroup.getCell(curCol).value = formatMonthLabel(m).toUpperCase();

    const subLabels = ['Hari', 'Jml Input', 'Output'];
    subLabels.forEach((lbl, sIdx) => {
      const subCell = rSub.getCell(curCol + sIdx);
      subCell.value = lbl;
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: mColor } };
      subCell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: COLORS.white } };
      subCell.alignment = { vertical: 'middle', horizontal: 'center' };
      subCell.border = BORDER_THIN;
    });
    curCol += 3;
  });

  // Total Periode group (4 cols)
  const totStartCol = curCol;
  ws.mergeCells(`${colLetter(totStartCol)}4:${colLetter(totStartCol + 3)}4`);
  for (let c = totStartCol; c <= totStartCol + 3; c++) {
    const topCell = rGroup.getCell(c);
    topCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
    topCell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
    topCell.alignment = { vertical: 'middle', horizontal: 'center' };
    topCell.border = BORDER_THIN;
  }
  rGroup.getCell(totStartCol).value = 'TOTAL KESELURUHAN';

  ['Hari Aktif', 'Total Input', 'Total Output', 'Rata2/Input'].forEach((lbl, sIdx) => {
    const subCell = rSub.getCell(totStartCol + sIdx);
    subCell.value = lbl;
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
    subCell.font = { name: FONT_NAME, size: 9, bold: true, color: { argb: COLORS.white } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    subCell.border = BORDER_THIN;
  });

  // Data rows
  const validEmployees = data.employeeList.filter(e => e.validInputs > 0);
  const startDataRow = 6;

  validEmployees.forEach((e, idx) => {
    const rowNum = startDataRow + idx;
    const r = ws.getRow(rowNum);
    const bg = idx % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;

    const fixedVals = [idx + 1, e.nama, e.nik, e.tipe_karyawan, e.posisi];
    fixedVals.forEach((v, cIdx) => {
      const cell = r.getCell(cIdx + 1);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { name: FONT_NAME, size: 10, bold: cIdx === 1, color: { argb: COLORS.bodyText } };
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: 'middle', horizontal: cIdx === 1 ? 'left' : 'center' };
    });

    const posStyle = getPosisiStyle(e.posisi);
    r.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: posStyle.bg } };
    r.getCell(5).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: posStyle.fg } };

    let cPtr = fixedCols.length + 1;
    months.forEach(m => {
      const md = e.months[m];
      const daysVal = md ? md.days.size : 0;
      const inpVal  = md ? md.inputs : 0;
      const outVal  = md ? md.output : 0;

      const vals = [daysVal, inpVal, outVal];
      vals.forEach((v, sIdx) => {
        const cell = r.getCell(cPtr + sIdx);
        cell.value = v;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.border = BORDER_THIN;
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = v === 0 ? '"-"' : '#,##0';
        cell.font = {
          name: FONT_NAME,
          size: 10,
          bold: sIdx === 2 && v > 0,
          color: { argb: v === 0 ? COLORS.mutedText : (sIdx === 2 ? COLORS.emerald : COLORS.bodyText) },
        };
      });
      cPtr += 3;
    });

    // Total columns
    const avgInput = e.validInputs > 0 ? e.totalOutput / e.validInputs : 0;
    const totVals = [e.validDays.size, e.validInputs, e.totalOutput, avgInput];
    totVals.forEach((v, sIdx) => {
      const cell = r.getCell(totStartCol + sIdx);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFF1F5F9' : 'FFE2E8F0' } };
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.numFmt = sIdx === 3 ? '#,##0.0' : '#,##0';
      cell.font = {
        name: FONT_NAME,
        size: 10,
        bold: sIdx === 1 || sIdx === 2,
        color: { argb: sIdx === 2 ? COLORS.navyMid : COLORS.bodyText },
      };
    });

    r.height = 20;
  });

  if (validEmployees.length > 0) {
    const endDataRow = startDataRow + validEmployees.length - 1;
    const totalRowNum = endDataRow + 1;
    const totR = ws.getRow(totalRowNum);
    ws.mergeCells(`A${totalRowNum}:E${totalRowNum}`);

    for (let c = 1; c <= totalCols; c++) {
      const cell = totR.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.totalBg } };
      cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.totalFg } };
      cell.border = BORDER_TOTAL;
      cell.alignment = { vertical: 'middle', horizontal: c <= 5 ? 'center' : 'right' };
    }
    totR.getCell(1).value = `GRAND TOTAL (${validEmployees.length} Karyawan)`;

    let cPtr = fixedCols.length + 1;
    months.forEach(() => {
      // Days column -> leave dash or max; Input & Output -> SUM formula
      totR.getCell(cPtr).value = '-';
      totR.getCell(cPtr).alignment = { vertical: 'middle', horizontal: 'center' };
      const inpL = colLetter(cPtr + 1);
      const outL = colLetter(cPtr + 2);
      totR.getCell(cPtr + 1).value = { formula: `SUM(${inpL}${startDataRow}:${inpL}${endDataRow})` };
      totR.getCell(cPtr + 1).numFmt = '#,##0';
      totR.getCell(cPtr + 2).value = { formula: `SUM(${outL}${startDataRow}:${outL}${endDataRow})` };
      totR.getCell(cPtr + 2).numFmt = '#,##0';
      cPtr += 3;
    });

    totR.getCell(totStartCol).value = data.activeDaysCount;
    totR.getCell(totStartCol).numFmt = '#,##0';
    const totInpL = colLetter(totStartCol + 1);
    const totOutL = colLetter(totStartCol + 2);
    totR.getCell(totStartCol + 1).value = { formula: `SUM(${totInpL}${startDataRow}:${totInpL}${endDataRow})` };
    totR.getCell(totStartCol + 1).numFmt = '#,##0';
    totR.getCell(totStartCol + 2).value = { formula: `SUM(${totOutL}${startDataRow}:${totOutL}${endDataRow})` };
    totR.getCell(totStartCol + 2).numFmt = '#,##0';
    totR.getCell(totStartCol + 3).value = { formula: `IF(${totInpL}${totalRowNum}>0,${totOutL}${totalRowNum}/${totInpL}${totalRowNum},0)` };
    totR.getCell(totStartCol + 3).numFmt = '#,##0.0';
    totR.height = 23;
  }

  // Column widths
  const widths = [7, 28, 15, 15, 13];
  months.forEach(() => { widths.push(9, 12, 14); });
  widths.push(11, 13, 15, 13);
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  applyPrintSetup(ws, true);
}

function buildDetailSheet(workbook, submissions, data, meta) {
  const ws = workbook.addWorksheet('Data Detail Submissions', {
    properties: { tabColor: { argb: COLORS.slateDark } },
    views: [{ state: 'frozen', ySplit: 4, showGridLines: true }],
  });

  const colConfigs = [
    { header: 'No',                 key: 'no',            minWidth: 8,  hasFilter: true },
    { header: 'Tgl Carian',         key: 'tgl_carian',    minWidth: 14, hasFilter: true },
    { header: 'Tgl Pengerjaan',     key: 'tgl_kerja',     minWidth: 15, hasFilter: true },
    { header: 'Nama Karyawan',      key: 'nama',          minWidth: 26, hasFilter: true },
    { header: 'NIK',                key: 'nik',           minWidth: 14, hasFilter: true },
    { header: 'Tipe Karyawan',      key: 'tipe_karyawan', minWidth: 16, hasFilter: true },
    { header: 'Posisi',             key: 'posisi',        minWidth: 12, hasFilter: true },
    { header: 'Tipe Lokasi',        key: 'tipe',          minWidth: 16, hasFilter: true },
    { header: 'Zona',               key: 'zona',          minWidth: 10, hasFilter: true },
    { header: 'Batch / Cluster',    key: 'batch',         minWidth: 18, maxWidth: 38, hasFilter: true },
    { header: 'Jumlah Output',      key: 'output',        minWidth: 16, hasFilter: true },
    { header: 'Status',             key: 'status',        minWidth: 13, hasFilter: true },
    { header: 'Catatan Tambahan',   key: 'catatan',       minWidth: 24, maxWidth: 40, hasFilter: true },
    { header: 'Waktu Submit',       key: 'waktu',         minWidth: 21, hasFilter: true },
  ];

  applyBanner(
    ws,
    colConfigs.length,
    'DATA DETAIL SUBMISSIONS — DC SS08',
    `Periode: ${meta.periodLabel}   |   Filter: ${meta.filterText}   |   Total Baris: ${submissions.length.toLocaleString('id-ID')} entri`
  );
  ws.getRow(3).height = 8;

  const headerRow = ws.getRow(4);
  colConfigs.forEach((cfg, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = cfg.header;
    const isOutput = cfg.key === 'output';
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isOutput ? COLORS.emerald : COLORS.navyMid } };
    cell.font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = BORDER_THIN;
  });
  headerRow.height = 25;

  const startDataRow = 5;
  submissions.forEach((s, i) => {
    const rowNum = startDataRow + i;
    const r = ws.getRow(rowNum);
    const bg = i % 2 === 0 ? COLORS.zebraEven : COLORS.zebraOdd;

    const namaKey = String(s.nama || '').toLowerCase().trim();
    const uInfo = data.userInfoMap[namaKey] || { nik: '-', tipe_karyawan: 'Belum Ditentukan' };
    const batchStr = parseBatches(s.batch_cluster).join(', ');
    const waktuStr = s.created_at
      ? new Date(s.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })
      : '-';
    const st = getStatusStyle(s.status);
    const pos = getPosisiStyle(s.posisi);

    const vals = [
      i + 1,
      s.tanggal_carian || '-',
      s.tanggal_pengerjaan || '-',
      s.nama || '-',
      uInfo.nik,
      uInfo.tipe_karyawan,
      s.posisi || '-',
      s.tipe_lokasi || '-',
      s.zona || '-',
      batchStr || '-',
      Number(s.jumlah_output) || 0,
      st.label,
      s.catatan_tambahan || '',
      waktuStr,
    ];

    vals.forEach((v, cIdx) => {
      const cell = r.getCell(cIdx + 1);
      cell.value = v;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { name: FONT_NAME, size: 10, color: { argb: COLORS.bodyText } };
      cell.border = BORDER_THIN;
      if (cIdx === 3 || cIdx === 9 || cIdx === 12) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else if (cIdx === 10) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });

    r.getCell(4).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.bodyText } };
    r.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pos.bg } };
    r.getCell(7).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: pos.fg } };
    r.getCell(11).numFmt = '#,##0';
    r.getCell(11).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: COLORS.navy } };
    r.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
    r.getCell(12).font = { name: FONT_NAME, size: 10, bold: true, color: { argb: st.fg } };
    r.height = 20;
  });

  if (submissions.length > 0) {
    const endDataRow = startDataRow + submissions.length - 1;
    ws.autoFilter = {
      from: { row: 4, column: 1 },
      to:   { row: endDataRow, column: colConfigs.length },
    };
  }

  autoFitColumns(ws, colConfigs.map(c => ({ ...c, scanFromRow: 4 })), 3);
  applyPrintSetup(ws, true);
}

async function generateSubmissionsExcelBuffer(submissions, users, query = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SS08 Admin — Formulir Pencapaian Kerja';
  workbook.created = new Date();

  const printedAt = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' WIB';

  const meta = {
    periodLabel: buildPeriodLabel(query, submissions),
    filterText: buildFilterSummaryText(query),
    printedAt,
  };

  const data = aggregateReportData(submissions, users);

  buildExecutiveSheet(workbook, data, meta);
  buildEmployeeSummarySheet(workbook, data, meta);
  buildMonthlyPerPersonSheet(workbook, data, meta);
  buildDetailSheet(workbook, submissions, data, meta);

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateSubmissionsExcelBuffer };
