const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const fetch = require('node-fetch');
const FormData = require('form-data');

function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  console.log(`[${timestamp}] [${level}] ${message}`);
}

const BASE_URL = process.env.BASE_URL;
const MARTINI_ACCESS_TOKEN = process.env.MARTINI_ACCESS_TOKEN;
const PACKAGE_DIR = process.env.PACKAGE_DIR || 'packages';
const PACKAGE_NAME_PATTERN = process.env.PACKAGE_NAME_PATTERN || '.*';
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '6', 10);
const POLL_PACKAGE = process.env.POLL_PACKAGE || '';

if (!BASE_URL) throw new Error('BASE_URL variable missing.');
if (!MARTINI_ACCESS_TOKEN) throw new Error('MARTINI_ACCESS_TOKEN variable missing.');

console.log(`BASE_URL: ${BASE_URL}`);
console.log(`PACKAGE_DIR: ${PACKAGE_DIR}`);
console.log(`PACKAGE_NAME_PATTERN: ${PACKAGE_NAME_PATTERN}`);
console.log(`MAX_ATTEMPTS: ${MAX_ATTEMPTS}`);
console.log(`POLL_PACKAGE: ${POLL_PACKAGE}`);

const FINAL_ZIP = path.join(process.env.BITBUCKET_CLONE_DIR || '.', 'packages.zip');

function isResolvable(host) {
  try {
    execSync(`getent hosts ${host}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function zipPackages(packageNames) {
  const zipCmd = `cd ${PACKAGE_DIR} && zip -qr ${FINAL_ZIP} ${packageNames.join(' ')}`;
  log('INFO', `Creating zip: ${zipCmd}`);
  execSync(zipCmd, { stdio: 'inherit' });
}

async function uploadZip() {
  log('INFO', 'Uploading packages to Martini...');
  const form = new FormData();
  form.append('file', fs.createReadStream(FINAL_ZIP), 'packages.zip');

  const res = await fetch(`${BASE_URL}/esbapi/packages/upload?stateOnCreate=STARTED&replaceExisting=true`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MARTINI_ACCESS_TOKEN}`,
      accept: 'application/json'
    },
    body: form
  });

  const status = res.status;
  if (status === 504 || status === 200) {
    log('INFO', `Package upload successful: ${status}`);
  } else {
    const text = await res.text();
    log('ERROR', `Package upload failed with HTTP code ${status}: ${text}`);
    process.exit(1);
  }
}

async function pollPackage(packageName, logStream) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE_URL}/esbapi/packages/${packageName}?version=2`, {
      headers: {
        Authorization: `Bearer ${MARTINI_ACCESS_TOKEN}`,
        accept: 'application/json'
      }
    });

    try {
      const json = await res.json();
      if (json.status === 'STARTED') {
        logStream.write(JSON.stringify(json) + '\n');
        return;
      }
    } catch {
      // ignore parse errors
    }

    log('INFO', `Waiting for ${packageName}... (${attempt}/${MAX_ATTEMPTS})`);
    await new Promise(resolve => setTimeout(resolve, 30000));
  }

  logStream.write(`ERROR: Package '${packageName}' timed out.\n`);
}

async function main() {
  const host = new URL(BASE_URL).hostname;
  if (!isResolvable(host)) {
    log('ERROR', `Cannot resolve host ${host}`);
    process.exit(1);
  }

  if (!fs.existsSync(PACKAGE_DIR)) {
    log('ERROR', `${PACKAGE_DIR} directory doesn't exist.`);
    process.exit(1);
  }

  const dirs = fs.readdirSync(PACKAGE_DIR)
    .filter(name => fs.statSync(path.join(PACKAGE_DIR, name)).isDirectory())
    .filter(name => new RegExp(PACKAGE_NAME_PATTERN).test(name));

  if (dirs.length === 0) {
    log('INFO', 'No matching packages to upload.');
    process.exit(0);
  }

  zipPackages(dirs);
  await uploadZip();

  const logStream = fs.createWriteStream('polling_results.log');

  const promises = (POLL_PACKAGE ? [POLL_PACKAGE] : dirs)
    .map(pkg => pollPackage(pkg, logStream));

  await Promise.all(promises);
  logStream.end(() => {
    log('INFO', 'Polling complete. Summary:');
    console.log(fs.readFileSync('polling_results.log', 'utf-8'));
  });
}

main().catch(err => {
  log('ERROR', err.message);
  process.exit(1);
});
