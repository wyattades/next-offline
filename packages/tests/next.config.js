const withManifest = require('next-manifest');
const withOffline = require('next-offline');

const withForceProd = require('./forceProd');

const defaultParams = {
  manifest: {
    output: './public/',
    short_name: 'next-offline-test-app',
    name: 'next-offline-test-app',
    description: 'Reproduce a bug to help fix it',
    dir: 'ltr',
    lang: 'en',
    icons: [
      {
        src: 'favicon.ico',
        sizes: '64x64 32x32 24x24 16x16',
        type: 'image/x-icon',
      },
    ],
    start_url: '/',
    display: 'standalone',
    theme_color: '#ffffff',
    background_color: '#ffffff',
  },
  offline: { dontAutoRegisterSw: true },
};

/** @type {import('next/dist/next-server/server/config').NextConfig} */
const nextConfig = {
  future: {
    webpack5: true,
  },
};

const withPlugins = (plugins, config) => {
  config = Object.assign({}, config, ...plugins.map((p) => p && p[1]).filter(Boolean));
  for (const p of plugins) if (p && p[0]) config = p[0](config);
  return config;
};

const buildConfig = ({ config = {}, manifest = null, offline = null, forceProd = false }) => {
  return withPlugins(
    [
      manifest && [withManifest, { manifest }],
      offline && [withOffline, offline],
      forceProd && [withForceProd],
    ],
    { ...nextConfig, ...config },
  );
};

const configStr = process.env.TEST_NEXT_BUILD_CONFIG;

const buildParams = configStr ? JSON.parse(configStr) : defaultParams;

console.log('Next.js build params:', buildParams);

module.exports = buildConfig(buildParams);
