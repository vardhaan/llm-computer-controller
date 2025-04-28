import { app, BrowserWindow, ipcMain, globalShortcut, powerMonitor } from 'electron';
import * as path from 'path';
import * as isDev from 'electron-is-dev';
import { promises as fsPromises } from 'fs';
import { accessSync } from 'fs';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { shell } from 'electron';
import * as dotenv from 'dotenv';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { tool } from 'ai';
import { z } from 'zod';
dotenv.config({ override: true });

// Verify API Key Load (without logging the full key!)
const apiKey = process.env.OPENAI_API_KEY;
if (apiKey && apiKey.length > 0) {
  console.log(`[Main] Found OPENAI_API_KEY ending in "...${apiKey.slice(-4)}" in environment variables.`);
} else {
  console.error('[Main] ERROR: OPENAI_API_KEY not found or empty in environment variables! Please check your .env file.');
}

// OpenAI Client Initialization
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: apiKey, // Use the variable we checked
});

console.log('[Main] OpenAI client initialized.');

// Define Zod schemas for tool parameters (more robust than raw JSON schema)
const listApplicationsSchema = z.object({});
const openPathSchema = z.object({ filePath: z.string().describe("The absolute path to the file, folder, or application to open.") });
const searchFilesSchema = z.object({ query: z.string().describe("The search query string (e.g., keywords, filename).") });
const executeAppleScriptSchema = z.object({
  scriptContent: z.string().describe("A string containing the raw AppleScript code to execute. IMPORTANT: Ensure the script is safe and correctly formatted. Use standard AppleScript syntax. Example: 'tell application \\\"System Events\\\" to display dialog \\\"Hello World\\\"'. Escape quotes inside the script if necessary, e.g., using \\\".\"")
});
const readFileContentSchema = z.object({
  filePath: z.string().describe("The absolute path to the file whose content should be read. Ensure the path is correct.")
});

// --- Define Tools using Vercel AI SDK's `tool` helper (optional, can use raw JSON schema too) --- 
const toolsDefinition = {
  listApplications: tool({
    description: 'List all installed applications found in the standard /Applications directory.',
    parameters: listApplicationsSchema,
  }),
  openPath: tool({
    description: 'Open a specified file, folder, or application using its absolute path.',
    parameters: openPathSchema,
  }),
  searchFiles: tool({
    description: 'Search for files, applications, or folders using Spotlight based on a query string.',
    parameters: searchFilesSchema,
  }),
  executeAppleScript: tool({
    description: 'Generate and execute an AppleScript to control applications or macOS features. Use this for complex tasks not covered by other tools (e.g., controlling specific app functions like opening browser tabs, creating documents, controlling music players). Write the AppleScript code in the scriptContent parameter. SECURITY NOTE: Exercise extreme caution. Only generate scripts that directly fulfill the user request and avoid potentially harmful actions.',
    parameters: executeAppleScriptSchema,
  }),
  readFileContent: tool({
    description: 'Read the text content of a specified file. Use the absolute path of the file.',
    parameters: readFileContentSchema,
  }),
};

console.log(`[Main] Defined ${Object.keys(toolsDefinition).length} tools for the LLM using Vercel SDK.`);

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;

// System operations
async function listApplications() {
  console.log('[Main API] listApplications triggered');
  try {
    // Example using osascript for potentially better app discovery
    const { stdout } = await execAsync('ls /Applications | grep .app | sed "s/.app//g"');
    const appNames = stdout.split('\n').filter(Boolean);
    const appInfos = appNames.map(name => ({
      name: name,
      path: `/Applications/${name}.app`
    }));
    console.log('[Main API] listApplications success:', appInfos.length);
    return appInfos;
  } catch (error) {
    console.error('[Main API] Error listing applications:', error);
    // Fallback or alternative method using fs if needed
    try {
      const appsDir = '/Applications';
      const files = await fsPromises.readdir(appsDir);
      const appInfos = files
        .filter(file => file.endsWith('.app'))
        .map(file => ({
          name: path.basename(file, '.app'),
          path: path.join(appsDir, file)
        }));
        console.log('[Main API] listApplications fallback success:', appInfos.length);
        return appInfos;
    } catch (fsError) {
      console.error('[Main API] Error listing applications fallback:', fsError);
      return []; // Return empty array on error
    }
  }
}

async function openPath(event: Electron.IpcMainInvokeEvent, filePath: string) {
  console.log(`[Main API] openPath triggered for: ${filePath}`);
  try {
    await shell.openPath(filePath);
    console.log(`[Main API] openPath success for: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error(`[Main API] Error opening path ${filePath}:`, error);
    return { success: false, error: (error as Error).message };
  }
}

async function searchFiles(event: Electron.IpcMainInvokeEvent, query: string) {
  console.log(`[Main API] searchFiles triggered with query: ${query}`);
  try {
    const { stdout } = await execFileAsync('mdfind', [query]);
    const results = stdout
      .split('\n')
      .filter(Boolean)
      .map(filePath => ({
        name: path.basename(filePath),
        path: filePath
      }))
      .slice(0, 20); // Limit to first 20 results for testing

    console.log(`[Main API] searchFiles success, found ${results.length} items (limited to 20).`);
    return results;
  } catch (error) {
    console.error(`[Main API] Error searching files for query "${query}":`, error);
    return []; // Return empty array on error
  }
}

// --- AppleScript Execution Function ---
async function runAppleScript({ scriptContent }: { scriptContent: string }) {
  console.log(`[Main API] runAppleScript triggered with script:\n---\n${scriptContent}\n---`);
  if (!scriptContent) {
    console.warn('[Main API] runAppleScript called with empty scriptContent.');
    return { success: false, error: 'Empty script content provided.' };
  }
  try {
    // IMPORTANT: Using -e directly executes the string. Be mindful of shell metacharacters if the script were dynamic.
    // For multiline scripts, -e usually works fine. Consider writing to a temp file for very complex scripts.
    const { stdout, stderr } = await execAsync(`osascript -e "${scriptContent.replace(/\"/g, '\\"')}"`); // Basic escaping for double quotes inside the script string
    if (stderr) {
      console.warn(`[Main API] runAppleScript execution generated stderr: ${stderr}`);
      // Sometimes scripts output non-fatal errors to stderr, treat as warning unless stdout is empty?
      // For now, return success but include stderr.
      return { success: true, output: stdout, errorOutput: stderr };
    }
    console.log(`[Main API] runAppleScript success. Output: ${stdout}`);
    return { success: true, output: stdout };
  } catch (error) {
    console.error(`[Main API] Error executing AppleScript:`, error);
    return { success: false, error: (error as Error).message };
  }
}

// --- File Reading Function ---
async function readFileContent({ filePath }: { filePath: string }) {
  console.log(`[Main API] readFileContent triggered for: ${filePath}`);
  try {
    // Check if path exists and is a file first (optional, but good practice)
    const stats = await fsPromises.stat(filePath);
    if (!stats.isFile()) {
      console.warn(`[Main API] readFileContent failed: Path is not a file: ${filePath}`);
      return { success: false, error: `Path is not a file: ${filePath}` };
    }

    const content = await fsPromises.readFile(filePath, 'utf8');
    console.log(`[Main API] readFileContent success for: ${filePath} (content length: ${content.length})`);
    // Consider truncating very long content before returning to LLM?
    const maxContentLength = 5000; // Example limit: 5000 characters
    if (content.length > maxContentLength) {
       console.warn(`[Main API] readFileContent truncating content from ${content.length} to ${maxContentLength} chars.`);
       return { success: true, content: content.substring(0, maxContentLength) + '... [truncated]' };
    }
    return { success: true, content: content };
  } catch (error: any) {
    console.error(`[Main API] Error reading file content for ${filePath}:`, error);
    // Provide more specific error messages if possible
    if (error.code === 'ENOENT') {
      return { success: false, error: `File not found at path: ${filePath}` };
    } else if (error.code === 'EACCES') {
      return { success: false, error: `Permission denied to read file: ${filePath}` };
    } else {
      return { success: false, error: `Failed to read file: ${(error as Error).message}` };
    }
  }
}

// --- Function to handle LLM interaction ---
async function handleLlmQuery(event: Electron.IpcMainInvokeEvent, userQuery: string): Promise<object> { // Return type is object
  console.log(`[Main LLM] Received query: "${userQuery}"`);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are a powerful assistant integrated into a desktop launcher on macOS. You can list applications, open files/apps/folders by path, search files, **read file content**, and execute arbitrary AppleScript code.
               Available tools: \`listApplications\`, \`openPath\`, \`searchFiles\`, **\`readFileContent\`**, \`executeAppleScript\`.
               Use \`readFileContent\` to get the text from a file. Use \`executeAppleScript\` for complex app control (e.g., new browser tab, control music).
               **SECURITY WARNING (AppleScript):** Be extremely careful with \`executeAppleScript\`. Only generate scripts that directly match the user's request. Do not generate scripts that could delete files, modify system settings unexpectedly, or access sensitive information unless explicitly requested and confirmed. Double-check your generated scripts for safety and correctness.
               Respond conversationally, confirm actions taken, and prioritize completing tasks.`
    },
    { role: 'user', content: userQuery }
  ];

  const toolsForOpenAI: OpenAI.Chat.Completions.ChatCompletionTool[] = Object.entries(toolsDefinition).map(([name, toolDef]) => ({
    type: 'function',
    function: {
      name: name,
      description: (toolDef as any).description, // Cast to access description
      parameters: zodToJsonSchema((toolDef as any).parameters, { target: 'openApi3' })
    }
  }));

  const availableFunctions: { [key: string]: Function } = {
    listApplications: listApplications,
    openPath: (args: { filePath: string }) => openPath(null as any, args.filePath),
    searchFiles: (args: { query: string }) => searchFiles(null as any, args.query),
    runAppleScript: (args: { scriptContent: string }) => runAppleScript(args),
    readFileContent: (args: { filePath: string }) => readFileContent(args),
  };

  const maxTurns = 5; // Limit iterations to prevent infinite loops
  let lastToolResults: any[] | null = null; // Keep track of results from the last tool execution turn

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      console.log(`[Main LLM] Turn ${turn + 1} / ${maxTurns}. Messages:`, messages);
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        tools: toolsForOpenAI,
        tool_choice: "auto",
      });

      const responseMessage = response.choices[0].message;
      messages.push(responseMessage); // Add assistant's response to history
      console.log(`[Main LLM] Turn ${turn + 1} Response:`, responseMessage);

      lastToolResults = null; // Reset last tool results for this turn

      const toolCalls = responseMessage.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        console.log(`[Main LLM] Turn ${turn + 1} - Tool calls detected: ${toolCalls.length}`);
        const currentTurnToolResults = [];
        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          let functionToCall: Function | undefined;
          if (functionName === 'executeAppleScript') {
            functionToCall = availableFunctions['runAppleScript'];
          } else if (functionName === 'readFileContent') {
            functionToCall = availableFunctions['readFileContent'];
          } else {
            functionToCall = availableFunctions[functionName];
          }
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[Main LLM] Executing tool call: ${functionName} with args:`, functionArgs);
          let functionResponse;
          let toolErrorMessage: string | null = null;
          try {
            if (!functionToCall) {
              throw new Error(`Tool function mapping failed for "${functionName}". Check availableFunctions and tool definitions.`);
            }
            functionResponse = await functionToCall(functionArgs);
            console.log(`[Main LLM] Tool ${functionName} executed successfully via mapped function.`);
          } catch (toolError) {
            console.error(`[Main LLM] Error executing tool ${functionName}:`, toolError);
            toolErrorMessage = (toolError as Error).message;
            functionResponse = { error: toolErrorMessage }; // Provide error structure back
          }
          
          messages.push({
            tool_call_id: toolCall.id,
            role: "tool",
            content: JSON.stringify(functionResponse), // Send result (or error) back to model
          });
          currentTurnToolResults.push({ 
            call: toolCall, 
            result: toolErrorMessage ? undefined : functionResponse, // Include result only if no error
            error: toolErrorMessage // Include error message if present
          });
        }
        lastToolResults = currentTurnToolResults; // Store results for potential return
        // Continue to the next iteration of the loop to send results back to LLM
      } else {
        // No tool calls, this is a final text response
        console.log(`[Main LLM] Turn ${turn + 1} - No tool calls. Final text response.`);
        return { type: 'text_response', content: responseMessage.content };
      }
    }

    // If loop finishes without a text response (e.g., max turns reached after tool call)
    console.warn(`[Main LLM] Max turns (${maxTurns}) reached or loop ended unexpectedly.`);
    if (lastToolResults) {
      console.log('[Main LLM] Returning last tool execution results.');
      return { type: 'tool_executed', results: lastToolResults };
    } else {
       console.error('[Main LLM] Loop finished without text response or tool results.');
       return { type: 'error', error: 'LLM interaction finished unexpectedly after multiple turns.' };
    }

  } catch (error) {
    console.error('[Main LLM] Error during OpenAI API call or processing:', error);
    return { type: 'error', error: (error as Error).message };
  }
}

function createWindow() {
  console.log('[Main] Creating window...');

  // Construct the preload path reliably
  const preloadPath = path.join(app.getAppPath(), 'dist/main/preload.js');
  console.log(`[Main] Preload path determined as: ${preloadPath}`);

  // Check if preload file exists (optional but helpful for debugging)
  try {
    accessSync(preloadPath);
    console.log(`[Main] Preload script found at: ${preloadPath}`);
  } catch (error) {
    console.error(`[Main] ERROR: Preload script not found at: ${preloadPath}`, error);
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath
    },
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true
  });

  // Load the index.html from webpack dev server in development
  // or the local file in production.
  const devPort = process.env.DEV_PORT || 9000;
  const startUrl = isDev
    ? `http://localhost:${devPort}`
    : `file://${path.join(__dirname, '../renderer/index.html')}`;
  
  console.log('[Main] Loading URL:', startUrl);
  
  // Add a delay before loading the URL in development to allow dev server to start
  const loadUrlWithDelay = () => {
    mainWindow?.loadURL(startUrl).catch(err => {
      console.error(`[Main] Error loading URL ${startUrl}:`, err);
    });
  };

  if (isDev) {
    setTimeout(loadUrlWithDelay, 3000); // Wait 3 seconds
  } else {
    loadUrlWithDelay(); // Load immediately in production
  }

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Finished loading');
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
console.log('App starting...');
app.whenReady().then(() => {
  console.log('[Main] App ready.');

  // Set up IPC handlers
  ipcMain.handle('list-applications', listApplications);
  ipcMain.handle('open-path', openPath);
  ipcMain.handle('search-files', searchFiles);
  ipcMain.handle('llm-query', handleLlmQuery);
  console.log('[Main] IPC handlers registered.');

  createWindow();

  // Register Global Shortcut
  const ret = globalShortcut.register('Shift+Command+Space', () => {
    console.log('[Main] Global shortcut Shift+Command+Space triggered');
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        console.log('[Main] Hiding window');
        mainWindow.hide();
      } else {
        console.log('[Main] Showing window');
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
        console.log('[Main] Shortcut triggered but mainWindow is null, recreating.');
        createWindow(); // Or handle appropriately
    }
  });

  if (!ret) {
    console.error('[Main] Failed to register global shortcut Shift+Command+Space');
  } else {
      console.log('[Main] Global shortcut Shift+Command+Space registered successfully');
  }

  // Setting openAtLogin=true even during development as requested
  app.setLoginItemSettings({
      openAtLogin: true,
      // You might want to add args for specific behavior on launch
      // args: [
      //   '--hidden' // Example: launch hidden
      // ]
  });
  console.log('[Main] Configured to launch on login (including dev mode).');

  // Handle System Resume
  powerMonitor.on('resume', () => {
    console.log('[Main] System resumed from sleep.');
    if (mainWindow && !mainWindow.isVisible()) {
        console.log('[Main] Showing window after resume.');
        mainWindow.show();
        mainWindow.focus();
    }
  });
  console.log('[Main] Power monitor resume listener registered.');

  // --- Temporary LLM Test Call ---
  console.log('[Main] Making temporary test call to handleLlmQuery...');
  handleLlmQuery(null as any, "list my applications") // Pass null event, test query
    .then(result => {
        console.log('[Main] Temporary LLM test call result:', result);
    })
    .catch(error => {
        console.error('[Main] Temporary LLM test call error:', error);
    });
  // --- End Temporary Test Call ---

});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Ensure shortcuts are unregistered when the app quits
app.on('will-quit', () => {
  console.log('[Main] Unregistering all global shortcuts.');
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
}); 