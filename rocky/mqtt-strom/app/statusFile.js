import fsPromises from 'node:fs/promises';

import AsyncLock  from 'async-lock';
import check      from 'check-types-2';
import fsExtra    from 'fs-extra';

const lock = new AsyncLock();

const statusFiles = [
  '/var/strom/strom.json',
  '/home/stheine/data/strom/strom.json',
];
let activeStatusFile;
let status;

export default {
  async read() {
    for(const statusFile of [activeStatusFile, ...statusFiles]) {
      try {
        status = await fsExtra.readJson(statusFile);

        activeStatusFile = statusFile;
      } catch{
        // ignore
      }
    }

    check.assert.assigned(activeStatusFile, 'No active status file detected');
    check.assert.nonEmptyObject(status, `Failed read status from ${activeStatusFile}`);

    return status;
  },

  async write(set) {
    check.assert.assigned(activeStatusFile, 'No active status file detected');

    await lock.acquire('status.json', async() => {
      for(const [key, value] of Object.entries(set)) {
        status[key] = value;
      }

      await fsPromises.copyFile(activeStatusFile, `${activeStatusFile}.bak`);
      await fsExtra.writeJson(activeStatusFile, status, {spaces: 2});
    });
  },
};
