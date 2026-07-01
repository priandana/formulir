const fs = require('fs');

let html = fs.readFileSync('public/admin.html', 'utf8');

// We want to insert the closing div for page-gsheets before the script template
const oldSnippet = `        </div>
      </div>

      <!-- Hidden template for connected state -->`;

const newSnippet = `        </div>
      </div>
    </div> <!-- Closes page-gsheets -->

      <!-- Hidden template for connected state -->`;

if (html.includes(oldSnippet)) {
  html = html.replace(oldSnippet, newSnippet);
  console.log('Fixed page-gsheets closing div successfully');
} else {
  // Let's try matching with single newlines
  const altOldSnippet = "        </div>\n      </div>\n\n      <!-- Hidden template for connected state -->";
  const altNewSnippet = "        </div>\n      </div>\n    </div> <!-- Closes page-gsheets -->\n\n      <!-- Hidden template for connected state -->";
  if (html.includes(altOldSnippet)) {
    html = html.replace(altOldSnippet, altNewSnippet);
    console.log('Fixed page-gsheets closing div successfully (alt)');
  } else {
    console.error('Target snippet not found in public/admin.html!');
  }
}

fs.writeFileSync('public/admin.html', html, 'utf8');
console.log('Done');
