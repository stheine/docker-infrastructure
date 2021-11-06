'use strict';

const sunspecMap = [{
// SunSpec start -----
  name:   'SID',
  start:  40001,
  end:    40002,
  type:   'string',
  expect: 'SunS',
}, {
// SunSpec Model 'common' -----
  name:   'ID (common)',
  start:  40003,
  end:    40003,
  type:   'uint16',
  expect: 1,
}, {
  name:   'L (common)',
  start:  40004,
  end:    40004,
  type:   'uint16',
  expect: 65,
}, {
  name:   'Mn',
  start:  40005,
  end:    40020,
  type:   'string',
  expect: 'Fronius',
}, {
  name:   'Md',
  start:  40021,
  end:    40036,
  type:   'string',
}, {
  name:   'Opt',
  start:  40037,
  end:    40044,
  type:   'string',
}, {
  name:   'Vr',
  start:  40045,
  end:    40052,
  type:   'string',
}, {
  name:   'SN',
  start:  40053,
  end:    40068,
  type:   'string',
}, {
  name:   'DA',
  start:  40069,
  end:    40069,
  type:   'uint16',
  expect: 200,
}, {
// SunSpec Model 'ac_meter'
  name:   'ID (ac_meter)',
  start:  40070,
  end:    40070,
  type:   'uint16',
  expect: 213,
}, {
  name:   'L (ac_meter)',
  start:  40071,
  end:    40071,
  type:   'uint16',
  expect: 124,
}, {
  name:   'A',
  start:  40072,
  end:    40073,
  type:  'float32',
}, {
  name:   'AphA',
  start:  40074,
  end:    40075,
  type:  'float32',
}, {
  name:   'AphB',
  start:  40076,
  end:    40077,
  type:  'float32',
}, {
  name:   'AphC',
  start:  40078,
  end:    40079,
  type:  'float32',
}, {
  name:   'PhV',
  start:  40080,
  end:    40081,
  type:  'float32',
}, {
  name:   'PhVphA',
  start:  40082,
  end:    40083,
  type:  'float32',
}, {
  name:   'PhVphB',
  start:  40084,
  end:    40085,
  type:  'float32',
}, {
  name:   'PhVphC',
  start:  40086,
  end:    40087,
  type:  'float32',
}, {
  name:   'PPV',
  start:  40088,
  end:    40089,
  type:  'float32',
}, {
  name:   'PPVphAB',
  start:  40090,
  end:    40091,
  type:  'float32',
}, {
  name:   'PPVphBC',
  start:  40092,
  end:    40093,
  type:  'float32',
}, {
  name:   'PPVphCA',
  start:  40094,
  end:    40095,
  type:  'float32',
}, {
  name:   'Hz',
  start:  40096,
  end:    40097,
  type:  'float32',
}, {
  name:   'W',
  start:  40098,
  end:    40099,
  type:  'float32',
}, {
  name:   'WphA',
  start:  40100,
  end:    40101,
  type:  'float32',
}, {
  name:   'WphB',
  start:  40102,
  end:    40103,
  type:  'float32',
}, {
  name:   'WphC',
  start:  40104,
  end:    40105,
  type:  'float32',
}, {
  name:   'VA',
  start:  40106,
  end:    40107,
  type:  'float32',
}, {
  name:   'VAphA',
  start:  40108,
  end:    40109,
  type:  'float32',
}, {
  name:   'VAphB',
  start:  40110,
  end:    40111,
  type:  'float32',
}, {
  name:   'VAphC',
  start:  40112,
  end:    40113,
  type:  'float32',
}, {
  name:   'VAR',
  start:  40114,
  end:    40115,
  type:  'float32',
}, {
  name:   'VARphA',
  start:  40116,
  end:    40117,
  type:  'float32',
}, {
  name:   'VARphB',
  start:  40118,
  end:    40119,
  type:  'float32',
}, {
  name:   'VARphC',
  start:  40120,
  end:    40121,
  type:  'float32',
}, {
  name:   'PF',
  start:  40122,
  end:    40123,
  type:  'float32',
}, {
  name:   'PFphA',
  start:  40124,
  end:    40125,
  type:  'float32',
}, {
  name:   'PFphB',
  start:  40126,
  end:    40127,
  type:  'float32',
}, {
  name:   'PFphC',
  start:  40128,
  end:    40129,
  type:  'float32',
}, {
  name:   'TotWhExp',
  start:  40130,
  end:    40131,
  type:  'float32',
}, {
  name:   'TotWhExpPhA',
  start:  40132,
  end:    40133,
  type:  'float32',
}, {
  name:   'TotWhExpPhB',
  start:  40134,
  end:    40135,
  type:  'float32',
}, {
  name:   'TotWhExpPhC',
  start:  40136,
  end:    40137,
  type:  'float32',
}, {
  name:   'TotWhImp',
  start:  40138,
  end:    40139,
  type:  'float32',
}, {
  name:   'TotWhImpPhA',
  start:  40140,
  end:    40141,
  type:  'float32',
}, {
  name:   'TotWhImpPhB',
  start:  40142,
  end:    40143,
  type:  'float32',
}, {
  name:   'TotWhImpPhC',
  start:  40144,
  end:    40145,
  type:  'float32',
}, {
  name:   'TotVAhExp',
  start:  40146,
  end:    40147,
  type:  'float32',
}, {
  name:   'TotVAhExpPhA',
  start:  40148,
  end:    40149,
  type:  'float32',
}, {
  name:   'TotVAhExpPhB',
  start:  40150,
  end:    40151,
  type:  'float32',
}, {
  name:   'TotVAhExpPhC',
  start:  40152,
  end:    40153,
  type:  'float32',
}, {
  name:   'TotVAhImp',
  start:  40154,
  end:    40155,
  type:  'float32',
}, {
  name:   'TotVAhImpPhA',
  start:  40156,
  end:    40157,
  type:  'float32',
}, {
  name:   'TotVAhImpPhB',
  start:  40158,
  end:    40159,
  type:  'float32',
}, {
  name:   'TotVAhImpPhC',
  start:  40160,
  end:    40161,
  type:  'float32',
}, {
// SunSpec 'end block'
  name:   'ID (end block)',
  start:  40196,
  end:    40196,
  type:   'uint16',
  expect: 0xFFFF,
}, {
  name:   'L (end block)',
  start:  40197,
  end:    40197,
  type:   'uint16',
  expect: 0,
}];

module.exports = sunspecMap;
