const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

const file = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(file, 'utf8');
const versionLabel = /(<span [^>]*\bid="appVersion">)[^<]*(<\/span>)/;
if (!versionLabel.test(html)) throw new Error('The header version label is missing from index.html');

fs.writeFileSync(file, html.replace(versionLabel, (_, start, end) => `${start}V${version}${end}`));
