const fs = require('fs');
const html = fs.readFileSync('public/admin.html', 'utf8');
const lines = html.split('\n');

let depth = 0;
let parentChain = [];

lines.forEach((l, i) => {
  const lineNum = i + 1;
  
  let idx = 0;
  while (true) {
    const openIdx = l.indexOf('<div', idx);
    const closeIdx = l.indexOf('</div>', idx);
    
    if (openIdx === -1 && closeIdx === -1) break;
    
    if (openIdx !== -1 && (closeIdx === -1 || openIdx < closeIdx)) {
      depth++;
      const idMatch = l.slice(openIdx).match(/id=["']([^"']+)["']/);
      const id = idMatch ? idMatch[1] : null;
      parentChain.push({ line: lineNum, id, tag: l.trim().slice(0, 45) });
      idx = openIdx + 4;
    } else {
      depth--;
      parentChain.pop();
      idx = closeIdx + 6;
    }
  }

  if (l.includes('id="page-absensi"')) {
    console.log('--- FOUND ABSENSI ---');
    console.log('Line number:', lineNum);
    console.log('Depth:', depth);
    console.log('Parent Chain:', JSON.stringify(parentChain, null, 2));
  }
});
