/**
 * Copyright 2017 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'assert';
import {existsSync} from 'fs';
import {mkdir, unlink} from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  Browser,
  BrowserPlatform,
  downloadUrls,
} from './browser-data/browser-data.js';
import {Cache, InstalledBrowser} from './Cache.js';
import {debug} from './debug.js';
import {detectBrowserPlatform} from './detectPlatform.js';
import {unpackArchive} from './fileUtil.js';
import {downloadFile, headHttpRequest} from './httpUtil.js';

const debugInstall = debug('puppeteer:browsers:install');

const times = new Map<string, [number, number]>();
function debugTime(label: string) {
  times.set(label, process.hrtime());
}

function debugTimeEnd(label: string) {
  const end = process.hrtime();
  const start = times.get(label);
  if (!start) {
    return;
  }
  const duration =
    end[0] * 1000 + end[1] / 1e6 - (start[0] * 1000 + start[1] / 1e6); // calculate duration in milliseconds
  debugInstall(`Duration for ${label}: ${duration}ms`);
}

/**
 * @public
 */
export interface InstallOptions {
  /**
   * Determines the path to download browsers to.
   */
  cacheDir: string;
  /**
   * Determines which platform the browser will be suited for.
   *
   * @defaultValue **Auto-detected.**
   */
  platform?: BrowserPlatform;
  /**
   * Determines which browser to install.
   */
  browser: Browser;
  /**
   * Determines which buildId to dowloand. BuildId should uniquely identify
   * binaries and they are used for caching.
   */
  buildId: string;
  /**
   * Provides information about the progress of the download.
   */
  downloadProgressCallback?: (
    downloadedBytes: number,
    totalBytes: number
  ) => void;
  /**
   * Determines the host that will be used for downloading.
   *
   * @defaultValue Either
   *
   * - https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing or
   * - https://archive.mozilla.org/pub/firefox/nightly/latest-mozilla-central
   *
   */
  baseUrl?: string;
  /**
   * Whether to unpack and install browser archives.
   *
   * @defaultValue `true`
   */
  unpack?: boolean;
}

/**
 * @public
 */
export async function install(
  options: InstallOptions
): Promise<InstalledBrowser> {
  options.platform ??= detectBrowserPlatform();
  options.unpack ??= true;
  if (!options.platform) {
    throw new Error(
      `Cannot download a binary for the provided platform: ${os.platform()} (${os.arch()})`
    );
  }
  const url = getDownloadUrl(
    options.browser,
    options.platform,
    options.buildId,
    options.baseUrl
  );
  const fileName = url.toString().split('/').pop();
  assert(fileName, `A malformed download URL was found: ${url}.`);
  const structure = new Cache(options.cacheDir);
  const browserRoot = structure.browserRoot(options.browser);
  const archivePath = path.join(browserRoot, fileName);
  if (!existsSync(browserRoot)) {
    await mkdir(browserRoot, {recursive: true});
  }

  if (!options.unpack) {
    if (existsSync(archivePath)) {
      return {
        path: archivePath,
        browser: options.browser,
        platform: options.platform,
        buildId: options.buildId,
      };
    }
    debugInstall(`Downloading binary from ${url}`);
    debugTime('download');
    await downloadFile(url, archivePath, options.downloadProgressCallback);
    debugTimeEnd('download');
    return {
      path: archivePath,
      browser: options.browser,
      platform: options.platform,
      buildId: options.buildId,
    };
  }

  const outputPath = structure.installationDir(
    options.browser,
    options.platform,
    options.buildId
  );
  if (existsSync(outputPath)) {
    return {
      path: outputPath,
      browser: options.browser,
      platform: options.platform,
      buildId: options.buildId,
    };
  }
  try {
    debugInstall(`Downloading binary from ${url}`);
    try {
      debugTime('download');
      await downloadFile(url, archivePath, options.downloadProgressCallback);
    } finally {
      debugTimeEnd('download');
    }

    debugInstall(`Installing ${archivePath} to ${outputPath}`);
    try {
      debugTime('extract');
      await unpackArchive(archivePath, outputPath);
    } finally {
      debugTimeEnd('extract');
    }
  } finally {
    if (existsSync(archivePath)) {
      await unlink(archivePath);
    }
  }
  return {
    path: outputPath,
    browser: options.browser,
    platform: options.platform,
    buildId: options.buildId,
  };
}

/**
 * @public
 */
export async function canDownload(options: InstallOptions): Promise<boolean> {
  options.platform ??= detectBrowserPlatform();
  if (!options.platform) {
    throw new Error(
      `Cannot download a binary for the provided platform: ${os.platform()} (${os.arch()})`
    );
  }
  return await headHttpRequest(
    getDownloadUrl(
      options.browser,
      options.platform,
      options.buildId,
      options.baseUrl
    )
  );
}

function getDownloadUrl(
  browser: Browser,
  platform: BrowserPlatform,
  buildId: string,
  baseUrl?: string
): URL {
  return new URL(downloadUrls[browser](platform, buildId, baseUrl));
}
