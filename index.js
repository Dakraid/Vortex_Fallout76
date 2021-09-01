const { actions, fs, util, selectors, log } = require('vortex-api');
const Promise = require("bluebird");
const { remote } = require('electron');
const winapi = require('winapi-bindings');
const path = require('path');
const semver = require('semver');
const IniParser = require('vortex-parse-ini');
const parser = new IniParser.default(new IniParser.WinapiFormat());

const GAME_ID = 'fallout76';
const STEAM_APP_ID = '1151340';
const ARCHIVE_EXT = '.ba2';
const fallout76CustomINI = 'Fallout76Custom.ini';
const iniPath = path.join(remote.app.getPath('documents'), 'My Games', 'Fallout 76');

const tools = [
    {
        id: 'FO76Edit',
        name: 'FO76Edit',
        logo: path.join('assets', 'fo76edit.png'),
        executable: () => 'FO76Edit.exe',
        requiredFiles: []
    }
]

function findGame() {
    return util.GameStoreHelper.findByAppId(STEAM_APP_ID)
        .then((game) => {
            return game.path;
        })
        .catch(() => {
            // Try finding the game on Bethesda.net if the Steam detection fails.
            const bethNetPath = winapi.RegGetValue('HKEY_LOCAL_MACHINE',
                'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Fallout 76',
                'Path');
            if (!bethNetPath) throw new Error('empty registry key');
            return Promise.resolve(instPath.value);
        });
}

function onGameModeActivated(gameId, api) {
    // Exit if we aren't managing Fallout 76
    if (gameId !== GAME_ID) return;
    const ini = path.join(iniPath, fallout76CustomINI)

    // Make sure the folder in My Documents exists, create it if not. 
    return fs.ensureDirAsync(iniPath)
        .then(() => {
            // See if our INI exists
            fs.statAsync(ini)
                .then(() => ini)
                .catch(err => {
                    // If the INI doesn't exist, make one.
                    if (err.code === 'ENOENT') return createINI(ini, api);
                    // report any other errors.
                    else api.sendNotification({ id: 'fallout76-ini-error', type: 'error', title: 'Error reading Fallout76Custom.ini', message: `${err.code} - ${err.message}` });
                })
        })
        .catch((err) => console.log('Error checking INI folder', err))

}

function createINI(iniLocation, api) {
    // Creates a new Fallout76Custom.ini with the default settings
    const defaultData =
        '[Archive]\n' +
        'sResourceArchive2List=\n' +
        'sResourceDataDirsFinal=STRINGS\\\n' +
        'bInvalidateOlderFiles=1\n';

    return fs.writeFileAsync(iniLocation, defaultData).then(() => iniLocation)
        .catch((err) => {
            api.sendNotification({ id: 'fallout76-ini-create-error', type: 'error', title: 'Could not create Fallout76Custom.ini', message: `${err.code} - ${err.message}` });
            return '';
        });
}

function testForArchives(files, gameId) {
    // Is this a Fallout 76 mod that includes BA2 files?
    const supported = (gameId === GAME_ID) && (files.find(file => path.extname(file).toLowerCase() === ARCHIVE_EXT) !== undefined);

    return Promise.resolve({
        supported,
        requiredFiles: []
    });
}

function installAndRegisterArchives(files) {
    let instructions = [];

    // Get an array of the file names of the ba2 files (in case they're nested for some reason)    
    const ba2Files = files.filter(f => path.extname(f).toLowerCase() === ARCHIVE_EXT).map(a => path.basename(a));
    // Add this attribute to the mod when we install it. 
    if (ba2Files.length) instructions.push({ type: 'attribute', key: 'ba2archives', value: ba2Files });

    // A basic install pattern just to ensure the files are still copied over. 
    const fileInstructions = files.map(f => { return { type: 'copy', source: f, destination: f } });

    // Combine the attributes and instructions, then return.
    instructions = instructions.concat(fileInstructions);
    return Promise.resolve({ instructions });
}

function updateArchiveList(profile, api) {
    // Get the current profile and check if it's for Fallout 76

    const state = api.store.getState();
    const gameId = profile.gameId;
    // Filter through the enabled mods that have BA2 archives
    const activeBA2Mods = Object.keys(profile.modState).map(key => {
        if (!profile.modState[key].enabled) return;
        const mod = state.persistent.mods[gameId][key];
        if (mod.attributes.ba2archives) return mod;
        else return;
    }).filter(m => m !== undefined);

    // Join up all the BA2s into a single array.
    const activeBA2s = activeBA2Mods.map((mod) => mod.attributes.ba2archives.join(',')).join(',').split(',');


    const gamePath = state.settings.gameMode.discovered[GAME_ID].path;
    const dataFolder = path.join(gamePath, 'Data');
    const fallout76Custom = path.join(iniPath, fallout76CustomINI);

    return parser.read(fallout76Custom)
        .then((ini) => {
            // const iniList = ini.data.Archive.sResourceArchive2List;
            // Also assume that the user is using only Vortex to handle the `sResourceArchive2List` lists
            // And assume vortex is deploying correctly Since going through the Data folder and original config seems unnecessary
            const cleanedArchivesList = [...new Set([...activeBA2s])].filter(function (el) {
                return !!el; // Removing empty strings
            });
            ini.data.Archive.sResourceArchive2List = cleanedArchivesList
            return parser.write(fallout76Custom, ini).then(() => Promise.resolve())
                .catch(err => log('error', 'Error updating Fallout76Custom.ini', err));
        })
        .catch(err => log('error', 'Error parsing Fallout76Custom.ini', err));
}


/**
 * Using the onStateChange props, this function checks for the profile that has changed and returns it
 * @param {*} previous 
 * @param {*} current 
 * @returns the changed profile
 */
function getChangedProfile(previous, current) {
    if ((previous === undefined) || (current === undefined)) {
        return;
    }
    const profileIds = Object.keys(previous)
    for (let i = 0; i < profileIds.length; i++) {
        const profileId = profileIds[i];
        if ((previous[profileId] !== current[profileId]) && (current[profileId] !== undefined)) {
            return current[profileId]
        }
    }
}

let debouceUpdate = setTimeout(() => { }, 0);

function deboucedUpdateArchiveList(previous, current, api) {
    const changedProfile = getChangedProfile(previous, current)
    if (!changedProfile) {
        return
    }
    updateArchiveList(changedProfile, api)
}

function main(context) {
    context.requireVersion('^1.2.0');
    context.registerGame({
        id: GAME_ID,
        name: 'Fallout 76',
        mergeMods: true,
        queryPath: findGame,
        supportedTools: tools,
        queryModPath: () => 'data',
        setup: () => onGameModeActivated(GAME_ID, context.api),
        logo: path.join('assets', 'gameart.jpg'),
        executable: () => 'Fallout76.exe',
        requiredFiles: [
            'Fallout76.exe',
        ],
        environment: {
            SteamAPPId: STEAM_APP_ID,
        },
        details: {
            steamAppId: STEAM_APP_ID,
        }
    });

    // We'll use an installer to save a list of included BA2 files to the mod.
    context.registerInstaller('fallout76-installer', 25, testForArchives, installAndRegisterArchives);

    // Migrate from a version below 2.0.0 - not tested but it should work. 
    context.registerMigration(old => migrate200(context.api, old));

    context.once(() => {
        // When we activate Fallout 76, make sure the custom INI exists.
        context.api.events.on('gamemode-activated', (gameId) => onGameModeActivated(gameId, context.api));

        // On profile state change update the list of BA2s
        context.api.onStateChange(['persistent', 'profiles'],
            (previous, current) => {
                clearTimeout(debouceUpdate)
                debouceUpdate = setTimeout(() => {
                    deboucedUpdateArchiveList(previous, current, context.api)
                }, 500);
            });
    });

    return true;
}

function migrate200(api, oldVersion) {
    // If the oldVersion is greater than or equal to 2.0.0, do nothing.
    if (semver.gte(oldVersion || '0.0.1', '2.0.0')) return Promise.resolve();

    const state = api.store.getState();
    const activatorId = selectors.activatorForGame(state, GAME_ID);
    const activator = util.getActivator(activatorId);
    const discovery = util.getSafe(state, ['settings', 'gameMode', 'discovered', BLOODSTAINED_ID], undefined);
    const mods = util.getSafe(state, ['persistent', 'mods', GAME_ID], undefined);

    // If we're not managed Fallout 76 yet, do nothing.
    if (discovery === undefined || !discovery.path === undefined || !activator === undefined) return Promise.resolve();

    // If we're not managing mods for Fallout 76, do nothing.
    if (mods === undefined || Object.keys(mods).length === 0) return Promise.resolve();

    const stagingFolder = selectors.installPath(store.getState());

    // Wait for the UI to load.
    return api.awaitUI()
        .then(() => {
            const modArray = Object.keys(mods).map(k => mods[k]);
            // Interate through each mod to check for BA2 archives.
            return Promise.all(modArray.map(mod => {
                return new Promise((resolve, reject) => {
                    const modPath = path.join(stagingFolder, mod.installationPath);
                    let ba2archives = [];
                    // Walk through all files for this mod, adding BA2s to the array.
                    util.walk(modPath, (iterPath, stats) => {
                        if (path.extname(iterPath) === ARCHIVE_EXT) {
                            return ba2archives.push(path.basename(iterPath));
                        }
                    })
                        // If we collected some BA2s, set the mod attribute.
                        .then(() => ba2archives.length ? api.store.dispatch(actions.setModAttribute(GAME_ID, mod.id, 'ba2archives', ba2archives)) : undefined)
                });
            }))
        })

}

module.exports = {
    default: main,
};