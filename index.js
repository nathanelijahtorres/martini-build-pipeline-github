const archiver = require('archiver');
const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');

const MARTINI_BASE_URL = core.getInput('base_url', {
    required: true,
});

const MARTINI_CLIENT_ID = core.getInput('client_id') || 'TOROMartini';

const MARTINI_CLIENT_SECRET = core.getInput('client_secret', {
    required: false,
});

const MARTINI_USER_NAME = core.getInput('user_name', {
    required: true,
});

const MARTINI_USER_PASSWORD = core.getInput('user_password', {
    required: true,
});

const PACKAGE_DIR = core.getInput('package_dir', {
    required: true,
});

const PACKAGE_NAME = path.basename(PACKAGE_DIR);
const ZIP_PATH = __dirname + `/${PACKAGE_NAME}.zip`;

async function uploadPackage() {
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', MARTINI_CLIENT_ID);
    tokenParams.append('client_secret', MARTINI_CLIENT_SECRET);
    tokenParams.append('grant_type', 'password');
    tokenParams.append('password', MARTINI_USER_PASSWORD);
    tokenParams.append('username', MARTINI_USER_NAME);

    const tokenResponse = await fetch(`${MARTINI_BASE_URL}/oauth/token`, {
        body: tokenParams,
        method: 'POST',
    });
    const tokenResponseJson = await tokenResponse.json();
    if (!tokenResponse.ok) {
        throw Error(JSON.stringify(tokenResponseJson));
    }

    const packageData = new FormData();
    packageData.set('file', await fs.openAsBlob(ZIP_PATH), `${PACKAGE_NAME}.zip`);

    const uploadResponse = await fetch(`${MARTINI_BASE_URL}/esbapi/packages/upload?stateOnCreate=STARTED&replaceExisting=true`, {
        body: packageData,
        headers: {
            Authorization: `Bearer ${tokenResponseJson['access_token']}`,
        },
        method: 'POST',
    });
    const uploadResponseJson = await uploadResponse.json();
    if (!uploadResponse.ok || uploadResponseJson.length !== 1) {
        throw Error(JSON.stringify(uploadResponseJson));
    }

    return uploadResponseJson[0];
}

function zipPackage() {
    const output = fs.createWriteStream(ZIP_PATH);
    const archive = archiver('zip', {
        zlib: { level: 9 },
    });

    return new Promise((resolve, reject) => {
        output.on('close', () => resolve());
        archive.on('error', err => reject(err));

        archive.pipe(output);
        archive.directory(PACKAGE_DIR, PACKAGE_NAME);
        archive.finalize();
    });
}

return zipPackage()
    .then(uploadPackage)
    .then(res => {
        core.info('Package uploaded successfully');

        core.setOutput('id', res.id);
        core.setOutput('name', res.name);
        core.setOutput('status', res.status);
        core.setOutput('version', res.version);
    })
    .catch((err) => {
        core.error(err);
        core.setFailed(err.message);
    });