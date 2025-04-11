const archiver = require('archiver');
const core = require('@actions/core');
const fs = require('fs');
const path = require('path');

const MARTINI_BASE_URL = core.getInput('base_url', {
    required: true,
});

const MARTINI_ACCESS_TOKEN = core.getInput('access_token', {
    required: true,
});

const PACKAGE_DIR = core.getInput('package_dir') || 'packages';

async function zipPackage(directory) {
    const PACKAGE_NAME = path.basename(directory);
    const ZIP_PATH = path.join(__dirname, `${PACKAGE_NAME}.zip`);

    const output = fs.createWriteStream(ZIP_PATH);
    const archive = archiver('zip', {
        zlib: { level: 9 },
    });

    return new Promise((resolve, reject) => {
        output.on('close', () => resolve(ZIP_PATH));
        archive.on('error', err => reject(err));

        archive.pipe(output);
        archive.directory(directory, PACKAGE_NAME);
        archive.finalize();
    });
}

async function uploadPackage(zipPath, PACKAGE_NAME) {
    const packageData = new FormData();
    packageData.set('file', await fs.openAsBlob(zipPath), `${PACKAGE_NAME}.zip`);

    const uploadResponse = await fetch(`${MARTINI_BASE_URL}/esbapi/packages/upload?stateOnCreate=STARTED&replaceExisting=true`, {
        body: packageData,
        headers: {
            Authorization: `Bearer ${MARTINI_ACCESS_TOKEN}`,
        },
        method: 'POST',
    });
    const uploadResponseJson = await uploadResponse.json();
    if (!uploadResponse.ok || uploadResponseJson.length !== 1) {
        throw Error(JSON.stringify(uploadResponseJson));
    }

    return uploadResponseJson[0];
}

async function processPackages() {
    const packageDirs = fs.readdirSync(PACKAGE_DIR).filter((file) => fs.statSync(path.join(PACKAGE_DIR, file)).isDirectory());

    for (const packageDir of packageDirs) {
        const directoryPath = path.join(PACKAGE_DIR, packageDir);
        try {
            core.info(`Zipping package: ${packageDir}`);
            const zipPath = await zipPackage(directoryPath);
            core.info(`Uploading package: ${packageDir}`);
            const res = await uploadPackage(zipPath, packageDir);
            core.info(`Package uploaded successfully: ${packageDir}`);

            core.setOutput('id', res.id);
            core.setOutput('name', res.name);
            core.setOutput('status', res.status);
            core.setOutput('version', res.version);
        } catch (err) {
            core.error(`Error with package ${packageDir}: ${err.message}`);
            core.setFailed(err.message);
        }
    }
}

processPackages()
    .catch((err) => {
        core.error(err);
        core.setFailed(err.message);
    });