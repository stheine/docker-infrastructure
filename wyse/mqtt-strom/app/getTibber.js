#!/usr/bin/env node

// https://developer.tibber.com/docs/reference

/* eslint-disable no-console */

import {TibberQuery} from 'tibber-api';

const queryUrl = 'https://api.tibber.com/v1-beta/gql';
const apiKey   = 'OIgp0L8pkSHTxFjQnRF4hlFOvp3e9I2yiAofBbyTdYY';
const homeId   = '18f1deda-8da8-4e58-8e1f-bf22fa94a345';

const config = {
  // Endpoint configuration.
  apiEndpoint: {
    apiKey,
    queryUrl,
  },
  homeId,
//  timestamp: true,
//  power:     true,
//  active: true,
};

const tibberQuery = new TibberQuery(config);

// console.log({tibberQuery});

// const queryHomes = '{viewer{homes{id size appNickname appAvatar address{address1 address2 address3 postalCode city country latitude longitude}}}}';
// const queryHomes = '{viewer{homes{id}}}';
// const result = await tibberQuery.query(queryHomes);

// console.log(JSON.stringify(result, null, 2));

const queryPrice = '{viewer{homes{currentSubscription{priceInfo{current{total} today{total energy startsAt currency level} tomorrow{total energy startsAt currency level}}}}}}';

const result = await tibberQuery.query(queryPrice);

console.log(JSON.stringify(result, null, 2));
