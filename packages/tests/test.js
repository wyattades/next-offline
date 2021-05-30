/**
@jest-environment node
**/

/// <reference types="jest"/>

const { join, resolve } = require('path');
const fs = require('fs-extra');
const execa = require('execa');
const puppeteer = require('puppeteer');

const { remove, readFile, access, readdir } = fs;
const cwd = process.cwd();

// Creates a RegExp for finding a file with a Next build hash.
const getFileHashRegex = (fileName, extension) =>
  new RegExp(`${fileName}([-\\w])*\\.${extension}$`);

// Read a directory and returns the file path for the first file name matching the provided RegExp.
const findHashedFileName = async (directoryPath, regexTest) => {
  const files = await readdir(directoryPath);
  return files.find((filePath) => regexTest.test(filePath));
};

const createProcess = (cmd, env = {}) => {
  const [file, ...args] = cmd.trim().split(/\s+/);
  const p = execa(file, args, {
    env,
    preferLocal: true,
  });

  p.stdout.on('data', (d) => process.stdout.write(`[${file} ${args[0]}] ${d.toString()}`));
  p.stderr.on('data', (d) => process.stderr.write(`[${file} ${args[0]}!] ${d.toString()}`));

  return {
    async wait() {
      await p;
    },
    async stop() {
      p.kill(9);
    },
  };
};

const createNextProcess = (params, argStr = 'build', env = {}) =>
  createProcess(`next ${argStr}`, {
    TEST_NEXT_BUILD_CONFIG: JSON.stringify(params),
    NEXT_TELEMETRY_DISABLED: '1',
    ...env,
  });

/**
 *
 * @param {puppeteer.Page} page
 */
const waitForConsoleMessage = (page, match, timeout = 5000) =>
  new Promise((resolve, reject) => {
    let timer;

    const onMsg = (msg) => {
      console.log('[browser console] ' + msg.text());
      if (match.test(msg.text())) {
        page.off('console', onMsg);
        clearTimeout(timer);
        resolve();
      }
    };

    timer = setTimeout(() => {
      page.off('console', onMsg);
      reject('waitForConsoleMessage: ' + match + ' timeout');
    }, timeout);

    page.on('console', onMsg);
  });

jest.setTimeout(40000);

beforeEach(async () => {
  await remove(join(cwd, 'out'));
  await remove(join(cwd, '.next'));
  await remove(join(cwd, 'public/manifest.json'));
});

const checkValid = async ({
  buildParams,

  hasSWFile = true,
  hasPrecachedAssets = true,
  hasInjectedAutoRegister = true,

  swDir = '.next/static',
  chunksDir = '.next/static/chunks',
} = {}) => {
  const swFile = join(swDir, 'service-worker.js');

  if (hasSWFile) {
    await access(swFile, fs.constants.F_OK);
  }

  if (hasPrecachedAssets) {
    const swContent = await readFile(swFile, 'utf8');

    // Check that various bundles are getting entered into pre-cache manifest
    expect(swContent).toEqual(expect.stringContaining('_next/static/chunks/pages/_app-'));
    expect(swContent).toEqual(expect.stringContaining('_next/static/chunks/webpack-'));
    expect(swContent).toEqual(expect.stringContaining('_next/static/chunks/framework-'));

    // Check that static asset copying via glob pattern is working as expected
    expect(swContent).toEqual(expect.stringContaining('_next/public/image.jpg'));
  }

  if (hasInjectedAutoRegister != null) {
    // Check registration logic exists
    const mainFileName = await findHashedFileName(chunksDir, getFileHashRegex('main', 'js'));
    const mainFileContents = await readFile(join(chunksDir, mainFileName), 'utf8');

    if (hasInjectedAutoRegister) {
      expect(mainFileContents).toEqual(expect.stringContaining('serviceWorker'));
    } else {
      expect(mainFileContents).not.toEqual(expect.stringContaining('serviceWorker'));
    }
  }

  // start a web server and make sure service worker successfully registers
  let browser, server;
  try {
    server = !buildParams
      ? createProcess(`http-server out -p 3000`)
      : createNextProcess(buildParams, 'start');

    browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto('http://localhost:3000');

    if (!hasInjectedAutoRegister) {
      // it won't register automatically, so register manually it with a <button/>
      await Promise.all([waitForConsoleMessage(page, /SW registered/), page.click('#register-sw')]);
    } else {
      await waitForConsoleMessage(page, /SW registered/);
    }
  } finally {
    await browser?.close();
    await server?.stop();
  }
};

test('withOffline builds a service worker file with auto-registration logic', async () => {
  const buildParams = {
    forceProd: true,
    offline: {},
  };

  await createNextProcess(buildParams).wait();

  await checkValid({
    buildParams,
  });
});

test('withOffline builds a service worker file without auto-registration logic when the consumer opts out', async () => {
  const buildParams = {
    forceProd: true,
    offline: { dontAutoRegisterSw: true },
  };

  await createNextProcess(buildParams).wait();

  await checkValid({
    buildParams,
    hasInjectedAutoRegister: false,
  });
});

test('withOffline pre-caches the generated manifest from withManifest', async () => {
  const buildParams = {
    forceProd: true,
    manifest: {
      output: './public/',
      name: 'next-app',
    },
    offline: {},
  };

  await createNextProcess(buildParams).wait();

  const swContent = await readFile(join(cwd, '.next', 'static', 'service-worker.js'), 'utf8');
  expect(swContent).toEqual(expect.stringContaining('_next/public/manifest.json'));

  await checkValid({
    buildParams,
  });
});

test('withOffline respects "swDest"', async () => {
  const customSWDest = 'foobar/service-worker.js';

  const buildParams = {
    forceProd: true,
    offline: { scope: '/foobar/', workboxOpts: { swDest: customSWDest } },
  };

  await createNextProcess(buildParams).wait();

  await access(join(cwd, '.next/static', customSWDest), fs.constants.F_OK);

  await checkValid({
    buildParams,
    swDir: '.next/static/foobar',
  });
});

test('withOffline `next export` generates service worker file with auto-registration logic', async () => {
  const buildParams = {
    forceProd: true,
    offline: {},
  };

  await createNextProcess(buildParams, 'build', { NEXT_OFFLINE_EXPORT: '1' }).wait();

  await createNextProcess(buildParams, 'export', { NEXT_OFFLINE_EXPORT: '1' }).wait();

  await checkValid({
    swDir: 'out',
    chunksDir: 'out/_next/static/chunks',
  });
});
