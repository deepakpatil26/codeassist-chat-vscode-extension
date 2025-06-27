import * as vscode from 'vscode';
import { Buffer } from 'buffer';

const panels = new Map<string, vscode.WebviewPanel>();
let lastInlineCompletion: {
  resolve: (value: string | undefined) => void;
} | null = null;

export function activate(context: vscode.ExtensionContext) {
  const startCommand = vscode.commands.registerCommand(
    'codeassist-chat.start',
    () => {
      createOrShowPanel(context);
    }
  );

  const summarizeCommand = vscode.commands.registerCommand(
    'codeassist-chat.summarizeFile',
    (uri: vscode.Uri) => {
      if (!uri && vscode.window.activeTextEditor) {
        uri = vscode.window.activeTextEditor.document.uri;
      }
      if (!uri) return;

      const panel = createOrShowPanel(context);
      const fileName = vscode.workspace.asRelativePath(uri, false);
      panel.webview.postMessage({
        command: 'startNewChat',
        data: { fileName, prompt: 'Summarize this file' },
      });
    }
  );

  const refactorCommand = vscode.commands.registerCommand(
    'codeassist-chat.refactorFile',
    (uri: vscode.Uri) => {
      if (!uri && vscode.window.activeTextEditor) {
        uri = vscode.window.activeTextEditor.document.uri;
      }
      if (!uri) return;

      const panel = createOrShowPanel(context);
      const fileName = vscode.workspace.asRelativePath(uri, false);
      panel.webview.postMessage({
        command: 'startNewChat',
        data: { fileName, prompt: 'Refactor this code: ' },
      });
    }
  );

  // Register inline completion provider
  const inlineProvider = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    {
      async provideInlineCompletionItems(
        document,
        position,
        _inlineContext,
        token
      ) {
        // Get the current line text up to the cursor
        const line = document
          .lineAt(position.line)
          .text.substring(0, position.character);

        // Don't trigger on empty lines
        if (!line.trim()) {
          return [];
        }

        const panel = createOrShowPanel(context);

        // Send request to webview app for inline suggestion
        panel.webview.postMessage({
          command: 'inlineCompletion',
          data: {
            language: document.languageId,
            line,
            fileName: vscode.workspace.asRelativePath(document.uri, false),
          },
        });

        // Wait for response from webview (with a timeout)
        const suggestion = await new Promise<string | undefined>((resolve) => {
          lastInlineCompletion = { resolve };
          setTimeout(() => resolve(undefined), 3000); // 3s timeout
        });

        if (token.isCancellationRequested) {
          return [];
        }

        if (suggestion) {
          return [
            {
              insertText: suggestion,
              range: new vscode.Range(position, position),
            },
          ];
        }
        return [];
      },
    }
  );

  context.subscriptions.push(
    startCommand,
    summarizeCommand,
    refactorCommand,
    inlineProvider
  );
}

function createOrShowPanel(
  context: vscode.ExtensionContext
): vscode.WebviewPanel {
  const column = vscode.window.activeTextEditor
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.One;

  if (panels.has('codeassist-chat')) {
    const panel = panels.get('codeassist-chat')!;
    panel.reveal(column);
    return panel;
  }

  const panel = vscode.window.createWebviewPanel(
    'codeassistChat',
    'CodeAssist Chat',
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  panels.set('codeassist-chat', panel);
  panel.onDidDispose(
    () => panels.delete('codeassist-chat'),
    null,
    context.subscriptions
  );
  panel.webview.html = getWebviewContent(panel.webview);

  // Handle messages from the webview (forwarded by the bridge script)
  panel.webview.onDidReceiveMessage(async (message) => {
    const { command, data } = message;
    const requestId = data?.requestId;

    switch (command) {
      case 'getWorkspaceFiles':
        handleGetWorkspaceFiles(panel.webview, requestId);
        return;
      case 'getFileContent':
        if (data?.fileName && requestId) {
          handleGetFileContent(panel.webview, data.fileName, requestId);
        }
        return;
      case 'insertText':
        insertTextAtCursor(data.text);
        return;
      case 'inlineCompletionResult':
        if (lastInlineCompletion) {
          lastInlineCompletion.resolve(data.suggestion);
          lastInlineCompletion = null;
        }
        return;
    }
  });

  // Set up file watcher
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  const onFileChange = () => handleGetWorkspaceFiles(panel.webview);
  watcher.onDidCreate(onFileChange);
  watcher.onDidDelete(onFileChange);
  context.subscriptions.push(watcher);

  return panel;
}

async function handleGetWorkspaceFiles(
  webview: vscode.Webview,
  requestId?: string
) {
  try {
    const files = await vscode.workspace.findFiles(
      '**/*.*',
      '**/node_modules/**'
    );
    const fileData = files.map((uri) => {
      const path = vscode.workspace.asRelativePath(uri, false);
      const type = /\.(jpg|jpeg|png|gif|svg)$/i.test(path) ? 'image' : 'file';
      return { name: path, type };
    });

    // This message is for both one-time requests (with requestId) and general updates
    webview.postMessage({
      command: 'workspaceFiles',
      requestId,
      data: { files: fileData },
    });
  } catch (error) {
    console.error('Error getting workspace files:', error);
  }
}

async function handleGetFileContent(
  webview: vscode.Webview,
  fileName: string,
  requestId: string
) {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) throw new Error('No workspace is open.');
    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, fileName);
    const fileContentBytes = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(fileContentBytes).toString('base64');
    webview.postMessage({
      requestId,
      data: { content },
    });
  } catch (error) {
    console.error(`Error reading file ${fileName}:`, error);
    webview.postMessage({
      requestId,
      data: { content: null, error: `Could not read file: ${fileName}` },
    });
  }
}

// Insert text at the current cursor position in the active editor
function insertTextAtCursor(text: string) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, text);
    });
  }
}

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function getWebviewContent(webview: vscode.Webview): string {
  const appUrl = 'https://codeassist-chat-app.vercel.app';
  const nonce = getNonce();

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CodeAssist Chat</title>
        <meta http-equiv="Content-Security-Policy" content="
            default-src 'none';
            frame-src ${appUrl};
            style-src 'unsafe-inline' ${webview.cspSource} https://fonts.googleapis.com;
            font-src https://fonts.gstatic.com;
            script-src 'nonce-${nonce}';
            connect-src ${appUrl};
        ">
        <style>
            body, html, iframe { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: hidden; border: none; }
        </style>
    </head>
    <body>
        <iframe id="app-frame" src="${appUrl}" allow="cross-origin-isolated"></iframe>
        <script nonce="${nonce}">
            // This script acts as a bridge between the iframe and the VS Code extension host.
            const vscode = acquireVsCodeApi();
            const iframe = document.getElementById('app-frame');
            const appOrigin = new URL('${appUrl}').origin;

            // 1. Listen for messages from the iframe and forward them to the extension host.
            window.addEventListener('message', event => {
                if (event.origin === appOrigin) {
                    vscode.postMessage(event.data);
                }
            });

            // 2. Listen for messages from the extension host and forward them to the iframe.
            window.addEventListener('message', event => {
                 if (event.origin !== appOrigin) {
                    // Check if contentWindow is available before posting message
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage(event.data, appOrigin);
                    }
                 }
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {}
