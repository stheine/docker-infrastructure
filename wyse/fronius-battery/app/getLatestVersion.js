// import _     from 'lodash';
// import axios from 'axios';
// import check from 'check-types-2';
// import {parseSetCookie} from 'set-cookie-parser';

export default async function getLatestVersion() {
//  let version;

// 1) working until January 2024
// const url = 'https://www.fronius.com/de-de/germany/solarenergie/installateure-partner/' +
//   'technische-daten/alle-produkte/wechselrichter/fronius-symo-gen24-plus/fronius-symo-gen24-8-0- plus';
// const response = await axios.get(url);
//
// check.assert.contains(response.data, 'Firmware Changelog Fronius Gen24 Tauro',
//   'Unexpected result in Product page');
//
// const latestVersion = response.data.replace(/^[\S\s]*Firmware Changelog Fronius Gen24 Tauro /,   '')
//   .replace(/<\/span>[\S\s]*$/, '');

// 2) new implementation in January 2024
//  const url = 'https://www.fronius.com/search/getdownloadcenter';
//  const data = '{' +
//    '"searchword":"update gen24 tauro",' +
//    '"countryPath":"/sitecore/content/Germany",' +
//    '"language":"de-DE",' +
//    '"selectedCountry":"Germany"' +
//    '}';
//  const downloads = response.data?.solarenergy?.downloads?.results;
//
//  check.assert.nonEmptyArray(downloads);
//
//  const firmware = _.find(downloads, download =>
//    download.type === 'Firmware' &&
//    download.title?.startsWith('Fronius Update GEN24 Tauro') &&
//    download.link?.endsWith('.swu'));
//
//  check.assert.nonEmptyObject(firmware);
//
//  return firmware.title.replace('Fronius Update GEN24 Tauro Verto ', '');

// 4) July 2025
//  const url = 'https://www.fronius.com/en/solar-energy/installers-partners/' +
//    'service-support/tech-support/software-and-updates/symo-gen24plus-update';
//
//  const response = await axios.get(url);
//
//  const version = response.data
//    .replace(/^.*Firmware Fronius Update GEN24 Tauro Verto /, '')
//    .replace(/".*$/, '');


//  // 5) February 2026
//  const url1 = 'https://www.fronius.com/en/solar-energy/installers-partners/downloads?';
//
//  const response1 = await axios.get(url1);
//
//  // console.log(response1.headers);
//
//  const cookies1 = parseSetCookie(response1);
//
//  console.log(cookies1);
//
//  const url2 = 'https://www.fronius.com/api/data/sessionRequestCookie';
//
//  const response2 = await axios.get(url2, {headers: {
//    cookies: cookies1.map(cookie => `${cookie.name}: ${cookie.value}`).join('; '),
//  }});
//
//  const cookies2 = parseSetCookie(response2);
//
//  console.log(cookies2);
//
//
//  const cookies = [
//    {name: 'fronius#lang', value: 'en'},
//    {name: 'UserLocation', value: ''},
//    ...cookies1, ...cookies2];
//
//  const url3 = 'https://www.fronius.com/search/getdownloadcenter';
//  const data = {
//    activeDepartment: 'perfectwelding',
//    id: 'aec9ed84-6e3f-476f-b5ca-9c326bc2c808',
//    initialSearch: true,
//    language: 'en',
//    perfectcharging: {
//      facets: [],
//      page: 1,
//    },
//    perfectwelding: {
//      facets: [],
//      page: 1,
//    },
//    searchword: 'gen24 firmware',
//    solarenergy: {
//      facets: [{
//        categoryId: 'DocumentType',
//        id: 'Firmware',
//      }],
//      page: 1,
//    },
//  };
//
//  console.log(cookies.map(cookie => `${cookie.name}: ${cookie.value}`));
//
//  const response3 = await axios.post(url3, {data, headers: {
//    cookies: cookies.map(cookie => `${cookie.name}: ${cookie.value}`).join('; '),
//    Accept: '*/*',
//    'Accept-Encoding': 'gzip, deflate, br, zstd',
//    'Accept-Language': 'de-DE,en-US;q=0.9,en;q=0.8',
//    'Cache-Control': 'max-age=0',
//    Connection: 'keep-alive',
//    'Content-Type': 'application/json; charset=utf-8',
//    DNT: 1,
//    Host: 'www.fronius.com',
//    Origin: 'https://www.fronius.com',
//    Priority: 'u=0',
//    Referer: 'https://www.fronius.com/en/solar-energy/installers-partners/downloads?searchword=gen24%20firmware',
//    'Sec-Fetch-Dest': 'empty',
//    'Sec-Fetch-Mode': 'cors',
//    'Sec-Fetch-Site': 'same-origin',
//    'Sec-GPC': 1,
//    TE: 'trailers',
//    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
//    'X-Requested-With': 'XMLHttpRequest',
//  }});
//
//  console.log(response3.data);
//
//  //  version = response.data
//  //    .replace(/^.*Fronius GEN24/, '');
//
//  // Return
//  check.assert.match(version, /^\d+\.\d+/);

  const version = 'unknown';

  return version;
}
