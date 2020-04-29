const Promise = require('bluebird');
const { util } = require('vortex-api');
const winapi = require('winapi-bindings');

function findGame() {
  try {
    const instPath = winapi.RegGetValue(
      'HKEY_LOCAL_MACHINE',
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 1151340',
      'InstallLocation');
    if (!instPath) {
      throw new Error('empty registry key');
    }
    return Promise.resolve(instPath.value);
  } catch (err) {
    return util.steam.findByName('Fallout 76')
      .then(game => game.gamePath);
  }
}

let tools = [
  {
    id: 'FO76Edit',
    name: 'FO76Edit',
    logo: 'fo3edit.png',
    executable: () => 'FO76Edit.exe',
    requiredFiles: [
      'FO76Edit.exe',
    ],
  },
];

function main(context) {
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

  return true;
}

module.exports = {
  default: main,
};