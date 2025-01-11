import fsExtra from 'fs-extra';

const configFiles = [
  '/var/strom/strom.json',
  '/home/stheine/data/strom/strom.json',
];
let activeConfigFile;

export default {
  async read() {
    let config;

    for(const configFile of [activeConfigFile, ...configFiles]) {
      try {
        config = await fsExtra.readJson(configFile);

        activeConfigFile = configFile;
      } catch{
        // ignore
      }
    }

    return config;
  },

  async write(config) {
    if(!activeConfigFile) {
      throw new Error('No active config file detected');
    }

    await fsExtra.writeJson(activeConfigFile, config, {spaces: 2});
  },
};
