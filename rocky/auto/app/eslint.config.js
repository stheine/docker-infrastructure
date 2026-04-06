import eslintConfig from '@stheine/helpers/eslint.config';

export default [
  ...eslintConfig,

  {settings: {react: {version: '999.999.999'}}},
];
