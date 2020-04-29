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
        return vortex_api_1.fs.readFileSync(iniPath).toString('UTF-8');
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
function debug(context) {
    electron_1.remote.getCurrentWebContents().toggleDevTools();
    const state = context.api.getState();
    const profile = vortex_api_1.selectors.activeGameId(state);
    console.log("Current gameID: " + profile);
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
    context.registerAction('global-icons', 300, 'settings', {}, 'FO76 Debug', () => {
        debug(context);
    });
    let prevDeployment;
    context.once(() => {
        context.api.events.on('did-deploy', (profileId, deployment) => {
            const gameId = vortex_api_1.selectors.activeGameId(context.api.getState());
            if ('fallout76' !== gameId) {
                return Promise.resolve();
            }
            if (prevDeployment !== deployment) {
                prevDeployment = deployment;
                let iniFile;
                parser.read(getINIFile(context))
                    .then((iniFileIn) => {
                    iniFile = iniFileIn;
                });
                console.log(iniFile);
            }
        });
    });
    return true;
}
exports.default = main;
