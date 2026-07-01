const fs = require('fs');
let js = fs.readFileSync('public/js/admin.js', 'utf8');

// 1. Add 'absensi' to page list in showPage
const oldPageList = "['dashboard','submissions','data-carian','rekap-toko','users','loader','export','gsheets','login-settings','admin-accounts','audit-logs','feature-guide']";
const newPageList = "['dashboard','submissions','data-carian','rekap-toko','users','loader','absensi','export','gsheets','login-settings','admin-accounts','audit-logs','feature-guide']";

if (!js.includes("'absensi'")) {
  js = js.replaceAll(oldPageList, newPageList);
  console.log('Page list patched');
}

// 2. Add 'absensi' to titles map
const oldTitles = "      'feature-guide': 'Panduan Fitur Baru'\n    };";
const newTitles = "      'feature-guide': 'Panduan Fitur Baru',\n      'absensi': 'Manajemen Absensi'\n    };";
if (!js.includes("'absensi': 'Manajemen Absensi'")) {
  js = js.replace(oldTitles, newTitles);
  console.log('Titles map patched');
}

// 3. Add absensi init call in showPage
const oldLoaderCall = "    if (page === 'loader') loadLoaderEntries();";
const newLoaderCall = "    if (page === 'loader') loadLoaderEntries();\n    if (page === 'absensi') { if (typeof initAbsensiPage === 'function') initAbsensiPage(); }";
if (!js.includes("initAbsensiPage")) {
  js = js.replace(oldLoaderCall, newLoaderCall);
  console.log('Absensi init call added');
}

// 4. Add 'absensiSettingsModal' to modal close list
const oldModalList = "['detailModal', 'importModal', 'addCarianModal', 'editUserModal', 'confirmModal', 'changePasswordModal']";
const newModalList = "['detailModal', 'importModal', 'addCarianModal', 'editUserModal', 'confirmModal', 'changePasswordModal', 'absensiSettingsModal']";
if (!js.includes('absensiSettingsModal')) {
  js = js.replace(oldModalList, newModalList);
  console.log('Modal close list patched');
}

fs.writeFileSync('public/js/admin.js', js, 'utf8');
console.log('Done! Lines:', js.split('\n').length);
