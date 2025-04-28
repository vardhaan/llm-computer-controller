import { app, BrowserWindow, ipcMain, globalShortcut, powerMonitor, dialog } from 'electron';
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
    description: 'Generate and execute an AppleScript to control applications or macOS features. Use this for complex tasks not covered by other tools (e.g., controlling specific app functions like **opening/controlling browser tabs/windows (Chrome, Safari, etc.)**, creating documents in Notes/TextEdit, controlling music players like Spotify/Music). Write the AppleScript code in the scriptContent parameter. SECURITY NOTE: Exercise extreme caution. Only generate scripts that directly fulfill the user request and avoid potentially harmful actions.',
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

// --- Modified AppleScript "Execution" Function (Now just signals for confirmation) ---
async function runAppleScriptNeedsConfirmation({ scriptContent }: { scriptContent: string }) {
  console.log(`[Main API] runAppleScript tool called by LLM. Script requires confirmation:\\n---\\n${scriptContent}\\n---`);
  if (!scriptContent) {
    console.warn('[Main API] runAppleScript called with empty scriptContent.');
    // Still return the structure, but indicate error or handle as appropriate
    return { needsConfirmation: false, error: 'Empty script content provided.' };
  }
  // Return an object indicating confirmation is needed, DO NOT EXECUTE HERE.
  return { needsConfirmation: true, scriptContent: scriptContent };
}

// --- NEW Handler for Actually Executing the Script After Frontend Confirmation ---
async function executeConfirmedAppleScript(event: Electron.IpcMainInvokeEvent, scriptContent: string) {
  console.log(`[Main API] executeConfirmedAppleScript triggered by frontend. Running script:\\n---\\n${scriptContent}\\n---`);
  if (!scriptContent) {
     return { success: false, error: 'Cannot execute empty script.' };
  }
  try {
    // Split script into lines, filter empty ones, and create args for execFile
    const scriptLines = scriptContent.split('\n').filter(line => line.trim() !== '');
    const osascriptArgs = scriptLines.reduce((acc, line) => {
      acc.push('-e', line.trim()); // Add -e flag and the trimmed line
      return acc;
    }, [] as string[]); // Initialize as string array

    console.log(`[Main API] Executing osascript with args:`, osascriptArgs);
    
    // Use execFile for cleaner argument handling, pass args array directly
    const { stdout, stderr } = await execFileAsync('osascript', osascriptArgs);

    if (stderr) {
      console.warn(`[Main API] executeConfirmedAppleScript execution generated stderr: ${stderr}`);
      // Return error if stderr is present, as it likely indicates a script failure
      return { success: false, error: `Script execution failed: ${stderr}` };
    }
    console.log(`[Main API] executeConfirmedAppleScript success. Output: ${stdout}`);
    return { success: true, output: stdout };
  } catch (error: any) { // Catch errors from execFileAsync
    console.error(`[Main API] Error executing confirmed AppleScript:`, error);
    // Provide more detailed error info if available (e.g., stderr from the caught error)
    const errorMessage = error.stderr ? `Command failed: ${error.stderr}` : (error as Error).message;
    return { success: false, error: errorMessage };
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
               **SECURITY WARNING (AppleScript):** Be extremely careful with \`executeAppleScript\`. It requires user confirmation before running. Only generate scripts that directly match the user's request. Do not generate scripts that could delete files, modify system settings unexpectedly, or access sensitive information unless explicitly requested and confirmed. Double-check your generated scripts for safety and correctness.
               Respond conversationally, confirm actions taken, and prioritize completing tasks.

**Tool Usage Guidelines:**
- Use \`openPath\` for simple opening of existing files, folders, or apps.
- Use \`searchFiles\` to find file paths.
- Use \`readFileContent\` to get the text content of a file.
- **Use \`executeAppleScript\` for ALL complex application control.** This includes, but is not limited to:
    - **Web Browser Control:** Opening new tabs, specific URLs, new windows (e.g., in Chrome, Safari).
    - **Application Interaction:** Creating new documents (Notes, TextEdit), controlling music playback (Spotify, Music), interacting with specific UI elements if necessary.
    - Any task requiring interaction *within* an application beyond just launching it.

**SECURITY WARNING (AppleScript):** Be extremely careful with \`executeAppleScript\`. It requires user confirmation before running. Only generate scripts that directly match the user's request. Do not generate scripts that could delete files, modify system settings unexpectedly, or access sensitive information unless explicitly requested and confirmed. Double-check your generated scripts for safety and correctness.

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

  // Map the LLM tool name 'executeAppleScript' to our *confirmation signaling* function
  const availableFunctions: { [key: string]: Function } = {
    listApplications: listApplications,
    openPath: (args: { filePath: string }) => openPath(null as any, args.filePath),
    searchFiles: (args: { query: string }) => searchFiles(null as any, args.query),
    executeAppleScript: (args: { scriptContent: string }) => runAppleScriptNeedsConfirmation(args), // Map to the confirmation function
    readFileContent: (args: { filePath: string }) => readFileContent(args),
  };

  const maxTurns = 5; // Limit iterations to prevent infinite loops

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      console.log(`[Main LLM] Turn ${turn + 1} / ${maxTurns}. Messages:`, messages.length); // Avoid logging full messages potentially containing sensitive args
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        tools: toolsForOpenAI,
        tool_choice: "auto",
      });

      const responseMessage = response.choices[0].message;
      messages.push(responseMessage); // Add assistant's response to history
      // console.log(`[Main LLM] Turn ${turn + 1} Response:`, responseMessage); // Avoid logging potentially sensitive response

      const toolCalls = responseMessage.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        console.log(`[Main LLM] Turn ${turn + 1} - Tool calls detected: ${toolCalls.length}`);

        // Flag to track if we need to return early for confirmation
        let confirmationRequired = false;
        let scriptToConfirm = '';

        // Process tool calls - We only add *results* back to the message history
        // AppleScript confirmation will return immediately
        const toolResultMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

        for (const toolCall of toolCalls) {
          const functionName = toolCall.function.name;
          const functionToCall = availableFunctions[functionName];
          // IMPORTANT: Use safe-stable-stringify or similar if args could be huge/circular, but JSON.parse is fine for expected OpenAI args.
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`[Main LLM] Processing tool call: ${functionName}`); // Avoid logging args directly

          if (!functionToCall) {
             console.error(`[Main LLM] Tool function mapping failed for "${functionName}".`);
             // Add an error result back to the LLM
             toolResultMessages.push({
               tool_call_id: toolCall.id,
               role: "tool",
               content: JSON.stringify({ error: `Unknown tool function: ${functionName}` }),
             });
             continue; // Process next tool call
          }

          try {
            // The actual function execution happens here (or confirmation signal)
            const functionResponse = await functionToCall(functionArgs);
            console.log(`[Main LLM] Tool ${functionName} processed.`);

            // **** SPECIAL HANDLING FOR APPLESCRIPT CONFIRMATION ****
            if (functionName === 'executeAppleScript') {
               // Check if the response object signals confirmation is needed
               if (functionResponse && typeof functionResponse === 'object' && functionResponse.needsConfirmation === true) {
                  console.log(`[Main LLM] AppleScript confirmation required for tool call ${toolCall.id}. Returning to frontend.`);
                  confirmationRequired = true;
                  scriptToConfirm = functionResponse.scriptContent;
                  // IMPORTANT: *Break* the loop and return immediately. Do NOT add this result to messages.
                  break;
               } else if (functionResponse && typeof functionResponse === 'object' && functionResponse.error) {
                 // Handle case where runAppleScriptNeedsConfirmation itself had an error (e.g., empty script)
                 console.warn(`[Main LLM] Pre-confirmation check for AppleScript failed: ${functionResponse.error}`);
                 toolResultMessages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: JSON.stringify({ error: functionResponse.error }),
                 });
               } else {
                 // Should not happen if runAppleScriptNeedsConfirmation is correct, but defensively handle unexpected response
                 console.error('[Main LLM] Unexpected response structure from runAppleScriptNeedsConfirmation:', functionResponse);
                 toolResultMessages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    content: JSON.stringify({ error: 'Internal error processing AppleScript confirmation.' }),
                 });
               }
               continue; // Continue processing other tool calls *unless* confirmationRequired was set and we broke
            }
            // **** END SPECIAL HANDLING ****

            // For all *other* successful tool calls, add their results to be sent back to LLM
            toolResultMessages.push({
              tool_call_id: toolCall.id,
              role: "tool",
              // Stringify the actual result from listApplications, searchFiles, etc.
              content: JSON.stringify(functionResponse),
            });

          } catch (toolError) {
            console.error(`[Main LLM] Error processing tool ${functionName}:`, toolError);
             toolResultMessages.push({
               tool_call_id: toolCall.id,
               role: "tool",
               content: JSON.stringify({ error: `Error executing tool ${functionName}: ${(toolError as Error).message}` }),
             });
          }
        } // End of for...of toolCalls loop

        // If confirmation is required, return the special object to the frontend immediately
        if (confirmationRequired) {
          // Ensure script content is valid before returning
          if (typeof scriptToConfirm !== 'string') {
             console.error('[Main LLM] Invalid script content type during confirmation return:', typeof scriptToConfirm);
             return { type: 'error', error: 'Internal error: Invalid script content for confirmation.' };
          }
          return { type: 'applescript_confirmation_required', scriptContent: scriptToConfirm };
        }

        // If no confirmation needed, add all gathered tool results to messages and continue loop
        if (toolResultMessages.length > 0) {
           messages.push(...toolResultMessages);
           console.log(`[Main LLM] Added ${toolResultMessages.length} tool results to history. Continuing LLM loop.`);
           continue; // Go to next LLM turn
        }

        // If there were tool calls but none resulted in messages (e.g., only AppleScript error happened)
        // Check if the assistant provided a text response alongside the failed tool call
        if (responseMessage.content) {
           console.log('[Main LLM] Tool calls processed with errors/no results, but text response found.');
           return { type: 'text_response', content: responseMessage.content };
        } else {
           console.warn('[Main LLM] Tool calls processed, but no results added, no confirmation requested, and no text response. Ending turn.');
           // Return an error as this state is unexpected
           return { type: 'error', error: 'LLM interaction finished unexpectedly after tool processing without results or text.' };
        }

      } else {
        // No tool calls, this is a final text response
        console.log(`[Main LLM] Turn ${turn + 1} - No tool calls. Final text response.`);
        // Ensure content is not null/undefined before returning
        if (responseMessage.content) {
           return { type: 'text_response', content: responseMessage.content };
        } else {
           console.warn('[Main LLM] Turn ended with no tool calls and no text content in the response message.');
           // It's possible the LLM just returns nothing, handle gracefully. Maybe return an empty text response?
           return { type: 'text_response', content: '' }; // Or return an error if this is unexpected
        }
      }
    } // End of for... turns loop

    // If loop finishes without a text response or confirmation (e.g., max turns reached)
    console.warn(`[Main LLM] Max turns (${maxTurns}) reached.`);
    // Return the last assistant message content if available, otherwise error
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant' && lastMessage.content) {
        console.log('[Main LLM] Max turns reached, returning last assistant text response.');
        return { type: 'text_response', content: lastMessage.content };
    } else {
        console.error(`[Main LLM] Max turns (${maxTurns}) reached without a final response or confirmation.`);
        return { type: 'error', error: `LLM interaction reached max turns (${maxTurns}) without a final response.` };
    }

  } catch (error) {
    console.error('[Main LLM] Error during OpenAI API call or processing:', error);
    // Check for specific OpenAI error types if needed, otherwise return generic message
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred during LLM processing.';
    return { type: 'error', error: errorMessage };
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
  ipcMain.handle('execute-confirmed-applescript', executeConfirmedAppleScript); // Register the new handler
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