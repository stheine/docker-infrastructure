import fsExtra from 'fs-extra';

const configFiles = [
  '/var/fritz/tr064Options.json',
  '/home/stheine/data/fritz/tr064Options.json',
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
