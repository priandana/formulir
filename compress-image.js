const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const input  = path.join(__dirname, 'public', 'login-hero.png');
const output = path.join(__dirname, 'public', 'login-hero.webp');
const outputPng = path.join(__dirname, 'public', 'login-hero-opt.png');

const beforeSize = fs.statSync(input).size;

Promise.all([
  // WebP — best compression, modern browsers
  sharp(input)
    .resize(1200, null, { withoutEnlargement: true }) // max width 1200px
    .webp({ quality: 80 })
    .toFile(output),

  // PNG fallback — compressed
  sharp(input)
    .resize(1200, null, { withoutEnlargement: true })
    .png({ compressionLevel: 9, quality: 80 })
    .toFile(outputPng),
]).then(([webpInfo, pngInfo]) => {
  const webpSize  = fs.statSync(output).size;
  const pngSize   = fs.statSync(outputPng).size;
  console.log(`Original  : ${(beforeSize  / 1024).toFixed(1)} KB`);
  console.log(`WebP      : ${(webpSize    / 1024).toFixed(1)} KB  (${Math.round((1 - webpSize/beforeSize)*100)}% saved)`);
  console.log(`PNG opt   : ${(pngSize     / 1024).toFixed(1)} KB  (${Math.round((1 - pngSize/beforeSize)*100)}% saved)`);
  console.log('Done!');
}).catch(err => console.error('Error:', err));
