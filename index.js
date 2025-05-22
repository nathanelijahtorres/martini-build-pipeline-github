const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const https = require('https');

function log(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function sanitizeKey(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function main() {
  try {
    const BASE_URL = core.getInput('base_url');
    const MARTINI_ACCESS_TOKEN = core.getInput('access_token');
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

    const { hostname, protocol } = new URL(BASE_URL);
    const httpLib = protocol === 'https:' ? require('https') : require('http');

    await new Promise((resolve, reject) => {
      httpLib.get({ hostname }, res => resolve())
        .on('error', () => reject(`Cannot resolve host ${hostname}`));
    }).catch(err => {
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
      log('INFO', 'No matching packages to upload.');
      process.exit(1);
    }

    const zipPath = path.join(process.env.GITHUB_WORKSPACE || '.', 'packages.zip');
    const zipArgs = ['-qr', zipPath, ...dirs];
    log('INFO', 'Creating zip with matching packages...');
    const zipResult = spawnSync('zip', zipArgs, { cwd: PACKAGE_DIR });
    if (zipResult.status !== 0) {
      log('ERROR', 'Failed to zip packages.');
      process.exit(1);
    }

    log('INFO', 'Uploading packages to Martini...');
    const uploadResult = spawnSync('curl', [
      '--silent', '--show-error', '--write-out', '%{http_code}', '--output', 'response_body.log',
      `${BASE_URL}/esbapi/packages/upload?stateOnCreate=STARTED&replaceExisting=true`,
      '-H', 'accept:application/json',
      '-F', `file=@${zipPath};type=application/zip`,
      '-H', `Authorization:Bearer ${MARTINI_ACCESS_TOKEN}`
    ]);
    const httpCode = uploadResult.stdout.toString().trim().slice(-3);

    let uploadResponse = [];
    try {
      const responseText = fs.readFileSync('response_body.log', 'utf8');
      uploadResponse = JSON.parse(responseText);
    } catch (_) {
      log('WARN', 'Failed to parse upload response JSON.');
    }

    const uploadSuccess = (code) => code === '504' || (code >= '200' && code < '300');

    if (!Array.isArray(uploadResponse)) {
      uploadResponse = [];
    }

    // Map each package dir to the corresponding uploaded package info by name
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
      console.log(fs.readFileSync('response_body.log', 'utf8'));
      process.exit(0);
    } else {
      log('ERROR', `Package upload failed with HTTP code: ${httpCode}`);
      console.error(fs.readFileSync('response_body.log', 'utf8'));
      process.exit(1);
    }

    if (!ASYNC_UPLOAD) return;

    const checkPackageStarted = async (packageName) => {
      for (let i = 0; i < SUCCESS_CHECK_TIMEOUT; i++) {
        const res = spawnSync('curl', [
          '-s',
          '-X', 'GET',
          `${BASE_URL}/esbapi/packages/${packageName}?version=2`,
          '-H', 'accept:application/json',
          '-H', `Authorization:Bearer ${MARTINI_ACCESS_TOKEN}`
        ]);
        try {
          const json = JSON.parse(res.stdout.toString());
          if (json.status === 'STARTED') {
            fs.appendFileSync('results.log', JSON.stringify(json, null, 2) + '\n');
            return;
          }
        } catch (_) {}

        log('INFO', `Waiting for ${packageName}... (${i + 1}/${SUCCESS_CHECK_TIMEOUT})`);
        await new Promise(r => setTimeout(r, SUCCESS_CHECK_DELAY * 1000));
      }
      log('ERROR', `Package '${packageName}' timed out.`);
      fs.appendFileSync('results.log', `Package '${packageName}' timed out.\n`);
    };

    const packagesToCheck = SUCCESS_CHECK_PACKAGE_NAME
      ? [SUCCESS_CHECK_PACKAGE_NAME]
      : dirs;

    log('INFO', `Checking ${packagesToCheck.length} package(s) for startup...`);
    await Promise.all(packagesToCheck.map(checkPackageStarted));

    log('INFO', 'Done checking packages:');
    console.log(fs.readFileSync('results.log', 'utf8'));
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();