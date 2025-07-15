// import _     from 'lodash';
import axios from 'axios';
import check from 'check-types-2';

export default async function getLatestVersion() {
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
  const url = 'https://www.fronius.com/en/solar-energy/installers-partners/' +
    'service-support/tech-support/software-and-updates/symo-gen24plus-update';

  const response = await axios.get(url);

  const version = response.data
    .replace(/^.*Firmware Changelog Fronius GEN24 Tauro Verto /, '')
    .replace(/".*$/, '');

  check.assert.match(version, /^\d+\.\d+/);

  return version;
}
