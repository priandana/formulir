const fs = require('fs');

// ===== FIX 1: admin.js — use window.initAbsensiPage =====
let js = fs.readFileSync('public/js/admin.js', 'utf8');
const oldCall = "if (page === 'absensi') { if (typeof initAbsensiPage === 'function') initAbsensiPage(); }";
const newCall = "if (page === 'absensi') { if (typeof window.initAbsensiPage === 'function') window.initAbsensiPage(); }";
if (js.includes(oldCall)) {
  js = js.replace(oldCall, newCall);
  console.log('Fixed: initAbsensiPage call uses window scope');
}

// Also expose showPage via window so onclick in HTML works (check if it exists)
if (!js.includes('window.showPage')) {
  // Find the last window.xxx = line and add showPage
  js = js.replace(
    'window.initCustomSelects = initCustomSelects;',
    'window.initCustomSelects = initCustomSelects;\n  window.showPage = showPage;'
  );
  console.log('Added window.showPage export');
}

fs.writeFileSync('public/js/admin.js', js, 'utf8');
console.log('admin.js done');

// ===== FIX 2: admin.html — expose initAbsensiPage to window =====
let html = fs.readFileSync('public/admin.html', 'utf8');
const oldInit = 'async function initAbsensiPage() {';
const newInit = 'window.initAbsensiPage = async function initAbsensiPage() {';
if (html.includes(oldInit) && !html.includes('window.initAbsensiPage')) {
  html = html.replace(oldInit, newInit);
  console.log('Fixed: initAbsensiPage exposed to window');
}
// Also fix other absensi functions that are called from onclick (like openAbsensiSettings, etc.)
const fns = [
  'function openAbsensiSettings()',
  'async function saveAbsensiSettings()',
  'async function absensiSemuaHadir()',
  'async function absensiClearSemua()',
  'function filterAbsensiUsers()',
  'async function toggleAbsensi(',
];
fns.forEach(fn => {
  const winFn = 'window.' + fn.replace('async function ', '').replace('function ', '').split('(')[0] + ' = ' + fn;
  if (html.includes(fn) && !html.includes('window.' + fn.replace('async function ', '').replace('function ', '').split('(')[0])) {
    html = html.replace(fn, 'window.' + fn.replace('async function ', '').replace('function ', '').split('(')[0] + ' = ' + fn.replace('async ', 'async '));
    console.log('Exposed to window:', fn.split('(')[0]);
  }
});

fs.writeFileSync('public/admin.html', html, 'utf8');
console.log('admin.html done');

// ===== FIX 3: Check custom-select-arrow CSS =====
// The arrows in screenshot are not native - they come from custom-select component
// Check the custom select trigger width
const css = fs.readFileSync('public/css/admin.css', 'utf8');
console.log('Has custom-select-arrow:', css.includes('.custom-select-arrow'));
console.log('Has overflow hidden on trigger:', css.includes('overflow: hidden') || css.includes('overflow:hidden'));
