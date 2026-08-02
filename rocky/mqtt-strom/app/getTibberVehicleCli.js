#!/usr/bin/env node

/* eslint-disable no-console */

import configFile       from './configFile.js';
import getTibberVehicle from './getTibberVehicle.js';
import statusFile       from './statusFile.js';

const config = await configFile.read();
const status = await statusFile.read();

const vehicleData = await getTibberVehicle({config, status});

console.log(vehicleData);
