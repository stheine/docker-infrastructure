import fsPromises from 'node:fs/promises';

import AsyncLock  from 'async-lock';
import check      from 'check-types-2';
import fsExtra    from 'fs-extra';

const lock = new AsyncLock();

const statusFiles = [
  '/var/auto/status.json',
  '/home/stheine/data/auto/status.json',
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
      const newStatus = {...status, ...set};

      await fsPromises.copyFile(activeStatusFile, `${activeStatusFile}.bak`);
      await fsExtra.writeJson(activeStatusFile, newStatus, {spaces: 2});

      status = newStatus;
    });
  },
};
