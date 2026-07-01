import re

with open('public/admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the function start and end by counting braces
start_marker = 'function renderAbsensiUserList() {'
start_idx = content.find(start_marker)
if start_idx == -1:
    print('ERROR: could not find renderAbsensiUserList')
    exit(1)

# Find the closing brace of this function
depth = 0
i = start_idx
in_string = False
string_char = None
while i < len(content):
    c = content[i]
    if in_string:
        if c == '\\':
            i += 2
            continue
        if c == string_char:
            in_string = False
    else:
        if c in ('"', "'", '`'):
            in_string = True
            string_char = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                end_idx = i + 1
                break
    i += 1

old_func = content[start_idx:end_idx]
print(f'Found function from {start_idx} to {end_idx}, length={len(old_func)}')

new_func = r"""function renderAbsensiUserList() {
  const container = document.getElementById('absensiUserList');
  const statsRow = document.getElementById('absensiStatsRow');
  const search = (document.getElementById('absensiSearch')?.value || '').toLowerCase();
  if (!container) return;

  if (absensiAllUsers.length === 0) {
    container.innerHTML = '<div class="absensi-empty-state"><svg width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" style="opacity:0.35; margin-bottom:12px;"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg><p>Belum ada karyawan terdaftar. Tambahkan karyawan di halaman Manajemen User.</p></div>';
    return;
  }

  const presentIds = new Set(absensiPresent.map(a => a.user_id));

  // Update global stats row
  if (statsRow) {
    statsRow.style.display = 'grid';
    document.getElementById('statHadir').textContent = presentIds.size;
    document.getElementById('statBelumHadir').textContent = absensiAllUsers.length - presentIds.size;
    document.getElementById('statTotalUser').textContent = absensiAllUsers.length;
  }

  // Update per-section tab counters
  ['Picker', 'Sorter', 'Loader'].forEach(sec => {
    const secUsers = absensiAllUsers.filter(u => (u.posisi || '') === sec);
    const secHadir = secUsers.filter(u => presentIds.has(u.id)).length;
    const el = document.getElementById('count' + sec);
    if (el) el.textContent = secHadir + '/' + secUsers.length;
  });
  const elSemua = document.getElementById('countSemua');
  if (elSemua) elSemua.textContent = presentIds.size + '/' + absensiAllUsers.length;

  // Apply section + search filter
  const filtered = absensiAllUsers.filter(u => {
    const matchSection = absensiActiveSection === 'Semua' || (u.posisi || '') === absensiActiveSection;
    const matchSearch = !search ||
      (u.nama_lengkap || '').toLowerCase().includes(search) ||
      (u.posisi || '').toLowerCase().includes(search) ||
      (u.username || '').toLowerCase().includes(search);
    return matchSection && matchSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="absensi-empty-state"><p>Tidak ada karyawan yang cocok.</p></div>';
    return;
  }

  // Sort: hadir first, then name
  const sorted = [...filtered].sort((a, b) => {
    const aH = presentIds.has(a.id) ? 0 : 1;
    const bH = presentIds.has(b.id) ? 0 : 1;
    return aH - bH || (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '');
  });

  container.innerHTML = sorted.map(user => {
    const hadir = presentIds.has(user.id);
    const initials = (user.nama_lengkap || user.username || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const posisiBadge = user.posisi ? getPosisiBadge(user.posisi) : '';
    const absenRecord = absensiPresent.find(a => a.user_id === user.id);

    return `
      <div class="absensi-user-card ${hadir ? 'hadir' : ''}" onclick="window.toggleAbsensi('${user.id}', '${absenRecord ? absenRecord.id : ''}')" data-user-id="${user.id}" data-nama="${(user.nama_lengkap || '').toLowerCase()}">
        <div class="absensi-user-avatar">${initials}</div>
        <div class="absensi-user-info">
          <div class="absensi-user-name">${user.nama_lengkap || user.username}</div>
          <div class="absensi-user-meta">${posisiBadge} ${hadir ? '<span style="color:#10B981; font-weight:600;">Hadir</span>' : '<span style="color:var(--text-dim);">Tidak Hadir</span>'}</div>
        </div>
        <div class="absensi-check-icon">
          ${hadir ? '<svg width="12" height="12" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
        </div>
      </div>
    `;
  }).join('');
}"""

new_content = content[:start_idx] + new_func + content[end_idx:]
with open('public/admin.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Successfully patched renderAbsensiUserList with section-aware version')
print(f'New file size: {len(new_content)} bytes')
