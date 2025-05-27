const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const archiver = require('archiver');
const fetch = require('node-fetch');
const FormData = require('form-data');

function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function sanitizeKey(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function checkHostReachable(hostname, protocol) {
  const lib = protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({ method: 'HEAD', hostname, timeout: 5000 }, res => {
      resolve(true);
    });
    req.on('error', () => reject(`Cannot resolve host ${hostname}`));
    req.on('timeout', () => {
      req.destroy();
      reject(`Timeout trying to reach host ${hostname}`);
    });
    req.end();
  });
}

async function createZip(packageDir, dirs, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', err => reject(err));

    archive.pipe(output);

    for (const dir of dirs) {
      archive.directory(path.join(packageDir, dir), dir);
    }

    archive.finalize();
  });
}

async function uploadZip(baseUrl, accessToken, zipPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(zipPath), {
    contentType: 'application/zip',
    filename: path.basename(zipPath),
  });

  const url = `${baseUrl}/esbapi/packages/upload?stateOnCreate=STARTED&replaceExisting=true`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  const text = await response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse upload response JSON: ${text}`);
  }

  if (!response.ok && response.status !== 504) {
    throw new Error(`Upload failed with status ${response.status}: ${text}`);
  }

  return { json, httpCode: response.status };
}

async function checkPackageStarted(baseUrl, accessToken, packageName, timeoutCount, delaySeconds) {
  const url = `${baseUrl}/esbapi/packages/${packageName}?version=2`;

  for (let i = 0; i < timeoutCount; i++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        log('WARN', `Polling package ${packageName} failed with status ${response.status}`);
      } else {
        const json = await response.json();
        if (json.status === 'STARTED') {
          fs.appendFileSync('results.log', JSON.stringify(json, null, 2) + '\n');
          return;
        }
      }
    } catch (e) {
      log('WARN', `Error polling package ${packageName}: ${e.message}`);
    }

    log('INFO', `Waiting for ${packageName}... (${i + 1}/${timeoutCount})`);
    await new Promise(r => setTimeout(r, delaySeconds * 1000));
  }

  log('ERROR', `Package '${packageName}' timed out.`);
  fs.appendFileSync('results.log', `Package '${packageName}' timed out.\n`);
}

async function main() {
  try {
    let BASE_URL = core.getInput('base_url', { required: true }).trim();
    BASE_URL = BASE_URL.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(BASE_URL)) {
      BASE_URL = `https://${BASE_URL}`;
    }

    const MARTINI_ACCESS_TOKEN = core.getInput('access_token', { required: true });
    const PACKAGE_DIR = core.getInput('package_dir') || 'packages';
    const PACKAGE_NAME_PATTERN = core.getInput('package_name_pattern') || '.*';
    const ASYNC_UPLOAD = core.getInput('async_upload') === 'true';
    const SUCCESS_CHECK_TIMEOUT = parseInt(core.getInput('success_check_timeout'), 10) || 6;
    const SUCCESS_CHECK_DELAY = parseInt(core.getInput('success_check_delay'), 10) || 30;
    const SUCCESS_CHECK_PACKAGE_NAME = core.getInput('success_check_package_name') || '';

    console.log(`BASE_URL: ${BASE_URL}`);
    console.log(`PACKAGE_DIR: ${PACKAGE_DIR}`);
    console.log(`PACKAGE_NAME_PATTERN: ${PACKAGE_NAME_PATTERN}`);
    console.log(`ASYNC_UPLOAD: ${ASYNC_UPLOAD}`);

    if (ASYNC_UPLOAD) {
      console.log(`SUCCESS_CHECK_TIMEOUT: ${SUCCESS_CHECK_TIMEOUT}`);
      console.log(`SUCCESS_CHECK_DELAY: ${SUCCESS_CHECK_DELAY}`);
      console.log(`SUCCESS_CHECK_PACKAGE_NAME: ${SUCCESS_CHECK_PACKAGE_NAME}`);
    }

    const url = new URL(BASE_URL);
    await checkHostReachable(url.hostname, url.protocol).catch(err => {
      log('ERROR', err);
      process.exit(1);
    });

    if (!fs.existsSync(PACKAGE_DIR)) {
      log('ERROR', `${PACKAGE_DIR} directory doesn't exist.`);
      process.exit(1);
    }

    const dirs = fs.readdirSync(PACKAGE_DIR).filter(d => {
      const fullPath = path.join(PACKAGE_DIR, d);
      return fs.statSync(fullPath).isDirectory() && new RegExp(PACKAGE_NAME_PATTERN).test(d);
    });

    if (dirs.length === 0) {
      log('ERROR', 'No matching packages to upload.');
      process.exit(1);
    }

    const zipPath = path.join(process.env.GITHUB_WORKSPACE || '.', 'packages.zip');

    log('INFO', 'Creating zip with matching packages...');
    await createZip(PACKAGE_DIR, dirs, zipPath);

    log('INFO', 'Uploading packages to Martini...');
    let uploadResult;
    try {
      uploadResult = await uploadZip(BASE_URL, MARTINI_ACCESS_TOKEN, zipPath);
    } catch (e) {
      log('ERROR', e.message);
      process.exit(1);
    }

    let { json: uploadResponse, httpCode } = uploadResult;

    const uploadSuccess = (code) => code === 504 || (code >= 200 && code < 300);

    if (!Array.isArray(uploadResponse)) {
      log('WARN', 'Upload response is not an array. Using empty array as fallback.');
      uploadResponse = [];
    }

    const outputPackages = dirs.map(name => {
      const pkgInfo = uploadResponse.find(p => p.name === name) || {};
      return {
        name,
        id: pkgInfo.id || '',
        status: pkgInfo.status || '',
        version: pkgInfo.version || '',
      };
    });

    outputPackages.forEach(pkg => {
      const key = sanitizeKey(pkg.name);
      core.setOutput(`${key}_id`, pkg.id);
      core.setOutput(`${key}_name`, pkg.name);
      core.setOutput(`${key}_status`, pkg.status);
      core.setOutput(`${key}_version`, pkg.version);
    });

    if (ASYNC_UPLOAD && uploadSuccess(httpCode)) {
      log('INFO', `Package upload successful. HTTP code: ${httpCode}`);
    } else if (!ASYNC_UPLOAD && httpCode >= 200 && httpCode < 300) {
      log('INFO', `Package upload successful. HTTP code: ${httpCode}`);
      console.log(JSON.stringify(uploadResponse, null, 2));
      process.exit(0);
    } else {
      log('ERROR', `Package upload failed with HTTP code: ${httpCode}`);
      console.error(JSON.stringify(uploadResponse, null, 2));
      process.exit(1);
    }

    if (!ASYNC_UPLOAD) return;

    const packagesToCheck = SUCCESS_CHECK_PACKAGE_NAME ? [SUCCESS_CHECK_PACKAGE_NAME] : dirs;

    log('INFO', `Checking ${packagesToCheck.length} package(s) for startup...`);
    await Promise.all(packagesToCheck.map(pkgName =>
      checkPackageStarted(BASE_URL, MARTINI_ACCESS_TOKEN, pkgName, SUCCESS_CHECK_TIMEOUT, SUCCESS_CHECK_DELAY)
    ));

    log('INFO', 'Done checking packages:');
    console.log(fs.readFileSync('results.log', 'utf8'));

  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
