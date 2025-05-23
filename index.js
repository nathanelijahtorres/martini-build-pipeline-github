const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');
const archiver = require('archiver');

function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function sanitizeKey(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function zipPackage(sourceDir, packageName) {
  const zipPath = path.join(process.env.GITHUB_WORKSPACE || '.', `${packageName}.zip`);
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(zipPath));
    archive.on('error', err => reject(err));
    archive.pipe(output);
    archive.directory(sourceDir, packageName);
    archive.finalize();
  });
}

async function uploadPackage(zipPath, packageName, baseUrl, token) {
  const form = new FormData();
  form.append('file', fs.createReadStream(zipPath), `${packageName}.zip`);

  const response = await fetch(`${baseUrl}/esbapi/packages/upload?stateOnCreate=STARTED&replaceExisting=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

async function checkPackageStarted(baseUrl, token, packageName, timeout, delay) {
  for (let i = 0; i < timeout; i++) {
    const response = await fetch(`${baseUrl}/esbapi/packages/${packageName}?version=2`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    });

    if (response.ok) {
      const json = await response.json();
      if (json.status === 'STARTED') return json;
    }

    log('INFO', `Waiting for ${packageName}... (${i + 1}/${timeout})`);
    await new Promise(r => setTimeout(r, delay * 1000));
  }

  throw new Error(`Package '${packageName}' timed out.`);
}

async function main() {
  try {
    const BASE_URL = core.getInput('base_url', { required: true });
    const TOKEN = core.getInput('access_token', { required: true });
    const PACKAGE_DIR = core.getInput('package_dir') || 'packages';
    const PACKAGE_NAME_PATTERN = core.getInput('package_name_pattern') || '.*';
    const ASYNC_UPLOAD = core.getInput('async_upload') === 'true';
    const SUCCESS_CHECK_TIMEOUT = parseInt(core.getInput('success_check_timeout')) || 6;
    const SUCCESS_CHECK_DELAY = parseInt(core.getInput('success_check_delay')) || 30;
    const SUCCESS_CHECK_PACKAGE_NAME = core.getInput('success_check_package_name') || '';

    const dirs = fs.readdirSync(PACKAGE_DIR).filter(d => {
      const fullPath = path.join(PACKAGE_DIR, d);
      return fs.statSync(fullPath).isDirectory() && new RegExp(PACKAGE_NAME_PATTERN).test(d);
    });

    if (dirs.length === 0) {
      log('INFO', 'No matching packages to upload.');
      return;
    }

    const outputPackages = [];

    for (const dir of dirs) {
      const fullPath = path.join(PACKAGE_DIR, dir);
      log('INFO', `Zipping package: ${dir}`);
      const zipPath = await zipPackage(fullPath, dir);

      log('INFO', `Uploading package: ${dir}`);
      const result = await uploadPackage(zipPath, dir, BASE_URL, TOKEN);

      if (!result.ok || !Array.isArray(result.body)) {
        throw new Error(`Upload failed for ${dir}: ${JSON.stringify(result.body)}`);
      }

      const pkg = result.body.find(p => p.name === dir) || {};
      outputPackages.push({ name: dir, ...pkg });
    }

    outputPackages.forEach(pkg => {
      const key = sanitizeKey(pkg.name);
      core.setOutput(`${key}_id`, pkg.id || '');
      core.setOutput(`${key}_name`, pkg.name || '');
      core.setOutput(`${key}_status`, pkg.status || '');
      core.setOutput(`${key}_version`, pkg.version || '');
    });

    if (!ASYNC_UPLOAD) return;

    const packagesToCheck = SUCCESS_CHECK_PACKAGE_NAME ? [SUCCESS_CHECK_PACKAGE_NAME] : dirs;
    log('INFO', `Checking ${packagesToCheck.length} package(s) for startup...`);

    for (const pkgName of packagesToCheck) {
      try {
        const result = await checkPackageStarted(BASE_URL, TOKEN, pkgName, SUCCESS_CHECK_TIMEOUT, SUCCESS_CHECK_DELAY);
        log('INFO', `Package ${pkgName} STARTED.`);
      } catch (err) {
        log('ERROR', err.message);
        core.setFailed(err.message);
      }
    }
  } catch (err) {
    core.setFailed(err.message);
  }
}

main();
