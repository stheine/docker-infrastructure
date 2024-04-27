import fsExtra from 'fs-extra';

const configFiles = [
  '/var/wetter/config.json',
  '/home/stheine/data/wetter/config.json',
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

    await fsExtra.writeJson(activeConfigFile, config);
  },
};
