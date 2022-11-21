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
const XBOX_ID = 'BethesdaSoftworks.Fallout76-PC';
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

async function findGame() {
  return util.GameStoreHelper.findByAppId([STEAM_APP_ID, XBOX_ID])
    .then((game) => {
      return game.gamePath;
      // return (game.gameStoreId === 'xbox') ? path.join(game.gamePath, 'Content') : game.gamePath;
    })
    .catch((err) => {
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

// NOTE: `const mod` can be undefined when the profile still has data for a modId, but the mod might've been uninstalled
function getBA2Mods(payload, excludeModCondition) {
  const { profile, state, gameId } = payload;
  const BA2Mods = Object.keys(profile.modState).map(modId => {
    if (!excludeModCondition(profile, modId)) return;
    const mod = state.persistent.mods[gameId][modId];
    if (mod && mod?.attributes && mod?.attributes.ba2archives) return mod;
    else return;
  }).filter(m => m !== undefined);

  // Join up all the BA2s into a single array.
  return BA2Mods.map((mod) => mod.attributes.ba2archives.join(',')).join(',').split(',');
}

function updateArchiveList(profile, api) {
  const state = api.store.getState();
  const gameId = profile.gameId;

  const payload = { profile, state, gameId }

  // Get all enabled BA2s into a single array.
  const enabledBA2s = getBA2Mods(payload, (profile, modId) => profile.modState[modId].enabled);

  // Get all disabled BA2s into a single array.
  const disbledBA2s = getBA2Mods(payload, (profile, modId) => !profile.modState[modId].enabled);

  const gamePath = state.settings.gameMode.discovered[GAME_ID].path;
  const dataFolder = path.join(gamePath, 'Data');
  const fallout76Custom = path.join(iniPath, fallout76CustomINI);

  return parser.read(fallout76Custom)
    .then((ini) => {
      const originalsResourceArchive2List = ini.data.Archive.sResourceArchive2List.split(',').map(s => s.trim());
      // Remove ba2s from archive list if is marked as disabled
      // This will allow for any user made changes to the sResourceArchive2List to be untouched
      let filteredOriginalsResourceArchive2List = originalsResourceArchive2List.filter(e => !disbledBA2s.includes(e));

      // Add to the filtered sResourceArchive2List the enabled mods, remove duplicates, and remove empty strings
      const cleanedArchivesList = [...new Set([...enabledBA2s, ...filteredOriginalsResourceArchive2List])].filter(function (el) {
        return !!el;
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
  // Ensure that the profile, the modstate and the gameid are correct
  if (!changedProfile || !changedProfile.modState || changedProfile.gameId !== GAME_ID) {
    // Return if no profile, or the profile is not for FO76
    return
  }
  updateArchiveList(changedProfile, api)
}

function findExecutable(discoveryPath) {
  const steamExe = 'Fallout76.exe';
  const xboxExe = 'Project76_GamePass.exe';

  if (!discoveryPath) return steamExe;

  try {
    // Steam version
    fs.statSync(path.join(discoveryPath, steamExe));
    return steamExe;
  }
  catch(err) {
    // Could not stat to Steam path
  }

  try {
    //Xbox version
    fs.statSync(path.join(discoveryPath, xboxExe));
    return xboxExe;
  }
  catch(err) {
    // Could not stat the Xbox path
  }

  log('error', 'Neither the Steam or Xbox EXE paths exist for Fallout 76');
  throw new Error('Neither the Steam or Xbox EXE paths exist for Fallout 76');
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
    executable: findExecutable,
    requiredFiles: [ 'Data' ],
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
  const discovery = util.getSafe(state, ['settings', 'gameMode', 'discovered', GAME_ID], undefined);
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
