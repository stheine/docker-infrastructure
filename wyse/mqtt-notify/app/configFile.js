import fsExtra from 'fs-extra';

const configFile     = '/var/pushover/config.json';
const configFileHost = '/mnt/qnap/linux/data/pushover/config.json';

export default {
  async read() {
    let config;

    try {
      config = await fsExtra.readJson(configFile);
    } catch(err) {
      if(err.message.includes('no such file')) {
        config = await fsExtra.readJson(configFileHost);
      } else {
        throw err;
      }
    }

    return config;
  },

  async write(config) {
    await fsExtra.writeJson(configFile, config);
  },
};
