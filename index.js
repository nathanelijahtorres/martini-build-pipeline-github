const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { URL } = require('url');
const dns = require('dns');

function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function sanitizeKey(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Check if hostname resolves before starting
async function checkHostResolvable(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err) => {
      if (err) reject(`Cannot resolve host ${hostname}: ${err.message}`);
      else resolve();
    });
  });
}

async function zipPackages(packageDir, packageNames) {
  return new Promise((resolve, reject) => {
    const zipPath = path.join(process.env.GITHUB_WORKSPACE || '.', 'packages.zip');
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve(zipPath);
    });
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    for (const pkgName of packageNames) {
      const fullDir = path.join(packageDir, pkgName);
      // Add directory to archive under folder named pkgName
      archive.directory(fullDir, pkgName);
    }

    archive.finalize();
  });
}

async function uploadPackage(zipPath, baseUrl, accessToken) {
  const form = new FormData();
  form.append('file', fs.createReadStream(zipPath), {
    contentType: 'application/zip',
    filename: 'packages.zip',
  });

  const res = await fetch(
    `${baseUrl}/esbapi/packages/upload?stateOnCreate=STARTED&replaceExisting=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...form.getHeaders(),
      },
      body: form,
    }
  );

  // We accept 504 or 2xx as success (like original script)
  if (!(res.status === 504 || (res.status >= 200 && res.status < 300))) {
    const text = await res.text();
    throw new Error(`Upload failed with HTTP code ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(`Unexpected upload response format`);
  }

  return { json, statusCode: res.status };
}

async function checkPackageStarted(
  baseUrl,
  accessToken,
  packageName,
  timeout,
  delay
) {
  for (let i = 0; i < timeout; i++) {
    try {
      const res = await fetch(
        `${baseUrl}/esbapi/packages/${packageName}?version=2`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      if (!res.ok) throw new Error(`HTTP status ${res.status}`);

      const json = await res.json();
      if (json.status === 'STARTED') {
        fs.appendFileSync('results.log', JSON.stringify(json, null, 2) + '\n');
        return;
      }
    } catch (err) {
      // ignore parse errors or network errors, keep waiting
    }

    log('INFO', `Waiting for ${packageName}... (${i + 1}/${timeout})`);
    await new Promise((r) => setTimeout(r, delay * 1000));
  }

  log('ERROR', `Package '${packageName}' timed out.`);
  fs.appendFileSync('results.log', `Package '${packageName}' timed out.\n`);
}

async function main() {
  try {
    const BASE_URL = core.getInput('base_url', { required: true });
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

    // Check host resolution
    const { hostname } = new URL(BASE_URL);
    await checkHostResolvable(hostname);

    if (!fs.existsSync(PACKAGE_DIR)) {
      log('ERROR', `${PACKAGE_DIR} directory doesn't exist.`);
      process.exit(1);
    }

    // Filter package dirs by regex pattern
    const dirs = fs.readdirSync(PACKAGE_DIR).filter((d) => {
      const fullPath = path.join(PACKAGE_DIR, d);
      return (
        fs.statSync(fullPath).isDirectory() && new RegExp(PACKAGE_NAME_PATTERN).test(d)
      );
    });

    if (dirs.length === 0) {
      log('INFO', 'No matching packages to upload.');
      process.exit(1);
    }

    log('INFO', 'Creating zip with matching packages...');
    const zipPath = await zipPackages(PACKAGE_DIR, dirs);

    log('INFO', 'Uploading packages to Martini...');
    const { json: uploadResponse, statusCode: httpCode } = await uploadPackage(
      zipPath,
      BASE_URL,
      MARTINI_ACCESS_TOKEN
    );

    // Output per-package info with sanitized keys
    const outputPackages = dirs.map((name) => {
      const pkgInfo = uploadResponse.find((p) => p.name === name) || {};
      return {
        name,
        id: pkgInfo.id || '',
        status: pkgInfo.status || '',
        version: pkgInfo.version || '',
      };
    });

    outputPackages.forEach((pkg) => {
      const key = sanitizeKey(pkg.name);
      core.setOutput(`${key}_id`, pkg.id);
      core.setOutput(`${key}_name`, pkg.name);
      core.setOutput(`${key}_status`, pkg.status);
      core.setOutput(`${key}_version`, pkg.version);
    });

    if (ASYNC_UPLOAD && (httpCode === 504 || (httpCode >= 200 && httpCode < 300))) {
      log('INFO', `Package upload accepted. HTTP code: ${httpCode}`);
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

    // Poll for package STARTED status
    const packagesToCheck = SUCCESS_CHECK_PACKAGE_NAME ? [SUCCESS_CHECK_PACKAGE_NAME] : dirs;

    log('INFO', `Checking ${packagesToCheck.length} package(s) for startup...`);
    await Promise.all(
      packagesToCheck.map((pkg) =>
        checkPackageStarted(BASE_URL, MARTINI_ACCESS_TOKEN, pkg, SUCCESS_CHECK_TIMEOUT, SUCCESS_CHECK_DELAY)
      )
    );

    log('INFO', 'Done checking packages:');
    console.log(fs.readFileSync('results.log', 'utf8'));
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
