"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const vortex_api_1 = require("vortex-api");
const electron_1 = require("electron");
const gt_1 = require("semver/functions/gt");
const winapi = require("winapi-bindings");
const path = require("path");
const vortex_parse_ini_1 = require("vortex-parse-ini");
const parser = new vortex_parse_ini_1.default(new vortex_parse_ini_1.WinapiFormat());
const ba2Files = [];
function getINIFile(context) {
    const configExample = '[Archive]\n' +
        'sResourceArchive2List=';
    const iniPath = path.join(electron_1.remote.app.getPath('documents'), 'My Games', 'Fallout 76', 'Fallout76Custom.ini');
    try {
        vortex_api_1.fs.statSync(iniPath);
    }
    catch (err) {
        vortex_api_1.fs.writeFileSync(iniPath, configExample);
    }
    try {
        return iniPath;
    }
    catch (err) {
        context.api.sendNotification({
            id: 'fallout76-noini',
            type: 'error',
            allowSuppress: false,
            message: 'Fallout 76 custom ini could not be read or created, please ensure write access for Vortex.',
        });
    }
}
function getBethPath() {
    const instPath = winapi.RegGetValue('HKEY_LOCAL_MACHINE', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Fallout 76', 'Path');
    return Promise.resolve(instPath.value);
}
function legacyFindGame() {
    try {
        const instPath = winapi.RegGetValue('HKEY_LOCAL_MACHINE', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 1151340', 'InstallLocation');
        return Promise.resolve(instPath.value);
    }
    catch (err) {
        return getBethPath();
    }
}
function findGame() {
    if (gt_1.default(electron_1.remote.app.getVersion(), '1.2.0')) {
        return vortex_api_1.util.GameStoreHelper.findByAppId('1151340')
            .then(game => {
            return game.path;
        })
            .catch(() => {
            return getBethPath();
        });
    }
    else {
        return legacyFindGame();
    }
}
function removeArchives(context, profileId, modId) {
    const state = context.api.getState();
    const gameId = vortex_api_1.selectors.activeGameId(state);
    if ('fallout76' !== gameId) {
        return Promise.resolve();
    }
    const mod = state.persistent.mods[gameId][modId];
    vortex_api_1.fs.readdirAsync(path.join(vortex_api_1.selectors.installPath(state), mod.installationPath))
        .then(files => {
        const archives = files.filter(fileName => ['.ba2'].indexOf(path.extname(fileName).toLowerCase()) !== -1);
        if (archives.length === 1) {
            const index = ba2Files.indexOf(archives, 0);
            if (index > -1) {
                archives.splice(index, 1);
            }
        }
        else if (archives.length > 1) {
            archives.forEach(archives => {
                const index = ba2Files.indexOf(archives, 0);
                if (index > -1) {
                    archives.splice(index, 1);
                }
            });
        }
    })
        .catch(err => {
        context.api.showErrorNotification('Failed to read mod', err);
    });
}
function addArchives(context, profileId, modId) {
    const state = context.api.getState();
    const gameId = vortex_api_1.selectors.activeGameId(state);
    if ('fallout76' !== gameId) {
        return Promise.resolve();
    }
    const mod = state.persistent.mods[gameId][modId];
    vortex_api_1.fs.readdirAsync(path.join(vortex_api_1.selectors.installPath(state), mod.installationPath))
        .catch(err => {
        if (err.code === 'ENOENT') {
            context.api.showErrorNotification('A mod could no longer be found on disk. Please don\'t delete mods manually '
                + 'but uninstall them through Vortex.', err, { allowReport: false });
            context.api.store.dispatch(vortex_api_1.actions.removeMod(gameId, modId));
            return Promise.reject(new vortex_api_1.util.ProcessCanceled('mod was deleted'));
        }
        else {
            return Promise.reject(err);
        }
    })
        .then(files => {
        const archives = files.filter(fileName => ['.ba2'].indexOf(path.extname(fileName).toLowerCase()) !== -1);
        if (archives.length === 1) {
            ba2Files.push(archives);
        }
        else if (archives.length > 1) {
            archives.forEach(archives => ba2Files.push(archives));
        }
    })
        .catch(err => {
        context.api.showErrorNotification('Failed to read mod', err);
    });
}
let tools = [{
        id: 'FO76Edit',
        name: 'FO76Edit',
        logo: 'fo3edit.png',
        executable: () => 'FO76Edit.exe',
        requiredFiles: [
            'FO76Edit.exe',
        ],
    },];
function main(context) {
    context.requireVersion('^1.2.0');
    context.registerGame({
        id: 'fallout76',
        name: 'Fallout 76',
        mergeMods: true,
        queryPath: findGame,
        supportedTools: tools,
        queryModPath: () => 'data',
        logo: 'assets\\gameart.jpg',
        executable: () => 'Fallout76.exe',
        requiredFiles: [
            'Fallout76.exe',
        ],
        environment: {
            SteamAPPId: '1151340',
        },
        details: {
            steamAppId: 1151340,
        }
    });
    let prevDeployment;
    context.once(() => {
        context.api.events.on('mod-disabled', (profileId, modId) => {
            removeArchives(context, profileId, modId);
        });
        context.api.events.on('mod-enabled', (profileId, modId) => {
            addArchives(context, profileId, modId);
        });
        context.api.events.on('did-purge', (profileId, deployment) => {
            const state = context.api.getState();
            const gameId = vortex_api_1.selectors.activeGameId(state);
            if ('fallout76' !== gameId) {
                return Promise.resolve();
            }
            if (prevDeployment !== deployment) {
                prevDeployment = deployment;
                let iniFile;
                parser.read(getINIFile(context))
                    .then((iniFileIn) => {
                    iniFile = iniFileIn;
                    iniFile.data.Archive.sResourceArchive2List = "";
                    parser.write(getINIFile(context), iniFile);
                });
            }
        });
        context.api.events.on('did-deploy', (profileId, deployment) => {
            const state = context.api.getState();
            const gameId = vortex_api_1.selectors.activeGameId(state);
            if ('fallout76' !== gameId) {
                return Promise.resolve();
            }
            if (prevDeployment !== deployment) {
                prevDeployment = deployment;
                let iniFile;
                parser.read(getINIFile(context))
                    .then((iniFileIn) => {
                    iniFile = iniFileIn;
                    iniFile.data.Archive.sResourceArchive2List = ba2Files.toString();
                    parser.write(getINIFile(context), iniFile);
                });
            }
        });
    });
    return true;
}
exports.default = main;
