import { defineConfig } from '@playwright/test';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
function chromePath(value) {
  if (!value) return undefined;
  try { if (!isAbsolute(value) || !statSync(value).isFile()) throw new Error(); accessSync(value, constants.X_OK); }
  catch { throw new Error(`PLAYWRIGHT_CHROME_PATH must be the absolute path of an existing, executable browser binary, but "${value}" is not. On macOS use "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", or unset it to use Playwright's bundled Chromium (npx playwright install chromium).`); }
  return value;
}
const executablePath = chromePath(process.env.PLAYWRIGHT_CHROME_PATH);
export default defineConfig({testDir:'tests/browser',workers:1,timeout:20000,use:{baseURL:'http://127.0.0.1:4320',headless:true,launchOptions:executablePath?{executablePath}:{}},webServer:{command:'node dist/server/main.js',url:'http://127.0.0.1:4320',reuseExistingServer:false,env:{PORT:'4320',APP_MODE:'mock',ALLOW_LIVE_API:'false',OPENAI_API_KEY:'',ALLOW_CLAUDE_CLI:'false',ALLOW_OLLAMA:'false'}}});
