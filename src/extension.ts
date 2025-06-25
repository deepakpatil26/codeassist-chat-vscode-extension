import * as vscode from 'vscode';
import { Buffer } from 'buffer';

const panels = new Map<string, vscode.WebviewPanel>();

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
      if (!uri) {
        uri = vscode.window.activeTextEditor?.document.uri!;
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
      if (!uri) {
        uri = vscode.window.activeTextEditor?.document.uri!;
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

  context.subscriptions.push(startCommand, summarizeCommand, refactorCommand);
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
    const { requestId } = data;
    switch (command) {
      case 'getWorkspaceFiles':
        handleGetWorkspaceFiles(panel.webview, requestId);
        return;
      case 'getFileContent':
        handleGetFileContent(panel.webview, data.fileName, requestId);
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

function getWebviewContent(webview: vscode.Webview): string {
  const appUrl = 'https://codeassist-chat-app.vercel.app';

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
            script-src 'unsafe-inline';
            connect-src ${appUrl};
        ">
        <style>
            body, html, iframe { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: hidden; border: none; }
        </style>
    </head>
    <body>
        <iframe id="app-frame" src="${appUrl}"></iframe>
        <script>
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
            // We can reuse the 'message' event listener because messages from the extension
            // will not have the same origin as the iframe.
            window.addEventListener('message', event => {
                 if (event.origin !== appOrigin) {
                    iframe.contentWindow.postMessage(event.data, appOrigin);
                 }
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {}
