const { GenerateSW, InjectManifest } = require('workbox-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { readFile, writeFile, copy } = require('fs-extra');
const { join } = require('path');

const preCacheManifestBlacklist = [
  // Next build metadata files that shouldn't be included in the pre-cache manifest.
  'react-loadable-manifest.json',
  'build-manifest.json',
  '_ssgManifest.js',
  '_buildManifest.js',

  // source maps
  /\.map$/,
];

// Directory where public assets must be placed in Next projects.
const nextAssetDirectory = 'public';

/** @type {import('workbox-webpack-plugin').InjectManifestOptions} */
const defaultInjectOpts = {
  exclude: [...preCacheManifestBlacklist], // `exclude` gets mutated
  modifyURLPrefix: {
    '/_next//static/': '/_next/static/', // fix weird url bug
    '/_next/public/': '/',
  },
};

/** @type {import('workbox-webpack-plugin').GenerateSWOptions} */
const defaultGenerateOpts = {
  ...defaultInjectOpts,
  // As of Workbox v5 Alpha there isn't a well documented way to move workbox runtime into the directory
  // required by Next. As a work around, we inline the tree-shaken runtime into the main Service Worker file
  // at the cost of less cacheability
  inlineWorkboxRuntime: true,
  runtimeCaching: [
    {
      urlPattern: /^https?.*/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'offlineCache',
        expiration: {
          maxEntries: 200,
        },
      },
    },
  ],
};

const writeTemplate = async (input, output, subs) => {
  let content = await readFile(input, 'utf8');

  for (const key in subs) {
    content = content.replace(`\{${key}\}`, subs[key]);
  }

  await writeFile(output, content, 'utf8');
};

const mergeRewrites = (prev, rewritesArr) => {
  if (!prev) return rewritesArr;

  if (Array.isArray(prev)) return [...prev, ...rewritesArr];

  return {
    ...prev,
    afterFiles: [...(prev.afterFiles || []), ...rewritesArr],
  };
};

/**
 * @param {import('next/dist/next-server/server/config').NextConfig} nextConfig
 * @returns {import('next/dist/next-server/server/config').NextConfig}
 */
module.exports = (nextConfig = {}) => {
  const {
    devSwSrc = join(__dirname, 'service-worker.js'),
    dontAutoRegisterSw = false,
    generateInDevMode = false,
    generateSw = true,
    // Before adjusting "workboxOpts.swDest" or "scope", read:
    // https://developers.google.com/web/ilt/pwa/introduction-to-service-worker#registration_and_scope
    scope = '/',
    workboxOpts = {},
  } = nextConfig;

  const swRelativeDest =
    workboxOpts.swDest != null ? join(workboxOpts.swDest) : 'service-worker.js';

  const swBuildDest = join('static', swRelativeDest);

  return {
    ...nextConfig,

    ...(process.env.NEXT_OFFLINE_EXPORT
      ? {
          // Copy service worker from Next.js build dir into the export dir during `next export`
          async exportPathMap(...args) {
            const [defaultPathMap, { dev, distDir, outDir }] = args;

            await copy(join(distDir, swBuildDest), join(outDir, swRelativeDest));

            // Run user's exportPathMap function if available.
            return nextConfig.exportPathMap ? nextConfig.exportPathMap(...args) : defaultPathMap;
          },
        }
      : {
          // rewrite service worker path in a Next.js dynamic server i.e. `next start` or `next dev`
          async rewrites() {
            return mergeRewrites(nextConfig.rewrites && (await nextConfig.rewrites()), [
              {
                source: `/${swRelativeDest}`,
                destination: `/_next/${swBuildDest}`,
              },
            ]);
          },
        }),

    webpack(config, options) {
      if (!options.defaultLoaders) {
        throw new Error(
          'This plugin is not compatible with Next.js versions below 5.0.0 https://err.sh/next-plugins/upgrade',
        );
      }

      const skipDuringDevelopment = options.dev && !generateInDevMode;

      // Generate SW
      if (skipDuringDevelopment) {
        // Simply copy development service worker.
        config.plugins.push(
          new CopyWebpackPlugin({ patterns: [{ from: devSwSrc, to: swRelativeDest }] }),
        );
      } else if (!options.isServer) {
        // Only run once for the client build.
        config.plugins.push(
          // Workbox uses Webpack's asset manifest to generate the SW's pre-cache manifest, so we need
          // to copy the app's assets into the Webpack context so those are picked up.
          new CopyWebpackPlugin({
            patterns: [{ from: `${join(process.cwd(), nextAssetDirectory)}/**/*` }],
          }),

          generateSw
            ? new GenerateSW({
                ...defaultGenerateOpts,
                ...workboxOpts,
                swDest: swBuildDest,
              })
            : new InjectManifest({
                ...defaultInjectOpts,
                ...workboxOpts,
                manifestTransforms: [
                  (manifest) => {
                    // injectOptions.exclude doesn't seem to work, so do it manually here
                    manifest = manifest.filter(({ url }) => {
                      for (const reg of preCacheManifestBlacklist) {
                        if (typeof reg === 'string') {
                          if (url.endsWith('/' + reg)) return false;
                        } else if (reg instanceof RegExp) {
                          if (reg.test(url)) return false;
                        }
                      }
                      return true;
                    });

                    return { manifest };
                  },
                ],
                swDest: swBuildDest,
              }),
        );
      }

      if (!options.isServer && !skipDuringDevelopment && !dontAutoRegisterSw) {
        // Inject auto-register-sw code

        const addToEntry = 'main.js';
        const originalEntry = config.entry;
        config.entry = async () => {
          const entries = await originalEntry();

          if (!Array.isArray(entries[addToEntry])) {
            console.warn(
              `[next-offline] Failed to add service worker auto-registration script: webpack entry-point "${addToEntry}" is not an array.`,
            );
            return entries;
          }

          const swCompiledPath = join(__dirname, 'register-sw-compiled.js');

          if (!entries[addToEntry].includes(swCompiledPath)) {
            await writeTemplate(require.resolve('./register-sw.js'), swCompiledPath, {
              SW_PATH: `/${swRelativeDest}`,
              SW_SCOPE: scope,
            });

            entries[addToEntry].unshift(swCompiledPath);
          }

          return entries;
        };
      }

      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, options);
      }

      return config;
    },
  };
};
