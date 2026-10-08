'use strict';
// One process of the fslock mutual-exclusion test: increments a shared counter file `n` times, each time as an
// unprotected-looking read-modify-write inside withFileLock. Any lost update shows up as a final count < total.
const fs = require('fs');
const { withFileLock } = require('../../src/core/fslock');

const [file, n] = [process.argv[2], Number(process.argv[3])];
for (let i = 0; i < n; i++) {
  withFileLock(file, () => {
    const cur = Number(fs.readFileSync(file, 'utf8')) || 0;
    fs.writeFileSync(file, String(cur + 1));
  });
}
console.log('ok');
