import * as Promise from 'bluebird';
import {fs, util, types, selectors} from 'vortex-api';
import { remote } from 'electron';
import semverGt from 'semver/functions/gt';
import * as winapi from 'winapi-bindings';
import * as path from 'path';
import IniParser, { IniFile, WinapiFormat } from 'vortex-parse-ini';

const parser = new IniParser(new WinapiFormat());

// INI Location Function
function getINIFile(context: types.IExtensionContext): string {
    const configExample = '[Archive]\n' +
        'sResourceArchive2List=';
    const iniPath = path.join(remote.app.getPath('documents'), 'My Games', 'Fallout 76', 'Fallout76Custom.ini');

    try {
        fs.statSync(iniPath);
    } catch (err) {
        fs.writeFileSync(iniPath, configExample);
    }
    
    try {
        return fs.readFileSync(iniPath).toString('UTF-8');
    } catch (err) {
        context.api.sendNotification({
            id: 'fallout76-noini',
            type: 'error',
            allowSuppress: false,
            message: 'Fallout 76 custom ini could not be read or created, please ensure write access for Vortex.',
        });
    }
}

// Game Location Functions
function getBethPath() {
    const instPath = winapi.RegGetValue(
        'HKEY_LOCAL_MACHINE',
        'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Fallout 76',
        'Path');
    return Promise.resolve(instPath.value);
}

function legacyFindGame() {
    try {
        const instPath = winapi.RegGetValue(
            'HKEY_LOCAL_MACHINE',
            'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 1151340',
            'InstallLocation');
        return Promise.resolve(instPath.value)
    } catch (err) {
        return getBethPath()
    }
}

function findGame(): Promise<string> {
    if (semverGt(remote.app.getVersion(), '1.2.0')) {
        return util.GameStoreHelper.findByAppId('1151340')
            .then(game => {
                return game.path
            })
            .catch(() => {
                return getBethPath()
            });
    } else {
        return legacyFindGame()
    }
}

/*
function doINI(profileId, deployment, context) {
    remote.getCurrentWebContents().toggleDevTools();
    const state = context.api.store.getState();
    const profile = selectors.activeProfile(state);
    
    if ('fallout76' !== profile.gameId) {
        return Promise.resolve();
    }
    
    if (prevDeployment !== deployment) {
        prevDeployment = deployment;
        context.api.sendNotification({
            id: 'bannerlord-activate-mods',
            type: 'info',
            allowSuppress: true,
            message: 'Use game launcher to activate mods',
        });
    }
}
*/

function debug(context: types.IExtensionContext) {
    remote.getCurrentWebContents().toggleDevTools();
    const state = context.api.getState();
    const profile = selectors.activeGameId(state);
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
}, ];

function main(context: types.IExtensionContext) {
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
            const gameId = selectors.activeGameId(context.api.getState());
    
            if ('fallout76' !== gameId) {
                return Promise.resolve();
            }
    
            if (prevDeployment !== deployment) {
                prevDeployment = deployment;

                let iniFile: IniFile<any>;
                
                parser.read(getINIFile(context))  
                    .then((iniFileIn: IniFile<any>) => {
                    iniFile = iniFileIn;
                })
                
                console.log(iniFile);
            }
        });
    });
    
    return true;
}

export default main;