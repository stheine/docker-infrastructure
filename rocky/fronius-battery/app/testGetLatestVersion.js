#!/usr/bin/env node

import {logger}         from '@stheine/helpers';

import getLatestVersion from './getLatestVersion.js';

const latestVersion = await getLatestVersion();

logger.info({latestVersion});
