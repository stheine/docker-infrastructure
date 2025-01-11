import fsExtra from 'fs-extra';

const configFiles = [
  '/var/strom/config.json',
  '/home/stheine/data/strom/config.json',
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
};
