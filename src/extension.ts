import * as vscode from 'vscode';

// A map to store our webview panel. We only want one instance.
const panels = new Map<string, vscode.WebviewPanel>();

// This function is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log(
    'Congratulations, your extension "codeassist-chat" is now active!'
  );

  let disposable = vscode.commands.registerCommand(
    'codeassist-chat.start',
    () => {
      // The command has been executed, so now we create and show a new webview panel
      console.log('Command "codeassist-chat.start" was executed!');

      // Check if a panel already exists and reveal it if it does
      if (panels.has('codeassist-chat')) {
        panels.get('codeassist-chat')?.reveal(vscode.ViewColumn.Beside);
        return;
      }

      // Otherwise, create a new panel
      const panel = vscode.window.createWebviewPanel(
        'codeassistChat', // Identifies the type of the webview. Used internally
        'CodeAssist Chat', // Title of the panel displayed to the user
        vscode.ViewColumn.Beside, // Editor column to show the new webview panel in
        {
          enableScripts: true, // Allow scripts to run in the webview
          retainContextWhenHidden: true, // Keep the webview's state even when it's not visible
        }
      );

      // Store the panel so we can reference it again
      panels.set('codeassist-chat', panel);

      // When the panel is disposed (e.g., closed by the user), remove it from our map
      panel.onDidDispose(
        () => {
          panels.delete('codeassist-chat');
        },
        null,
        context.subscriptions
      );

      // Set the HTML content for the webview
      panel.webview.html = getWebviewContent(panel.webview);

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(
        async (message) => {
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
        },
        undefined,
        context.subscriptions
      );

      // Watch for file changes and push updates to the webview
      const watcher = vscode.workspace.createFileSystemWatcher('**/*');
      const onFileChange = () => handleGetWorkspaceFiles(panel.webview);
      watcher.onDidCreate(onFileChange);
      watcher.onDidDelete(onFileChange);
      context.subscriptions.push(watcher);
    }
  );

  context.subscriptions.push(disposable);
}

// Function to get all workspace files and send them to the webview
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
      command: 'workspaceFiles', // For general listeners
      requestId: requestId, // For one-time requests
      data: { files: fileData },
    });
  } catch (error) {
    console.error('Error getting workspace files:', error);
  }
}

// Function to read a specific file's content and send it to the webview
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
      requestId: requestId,
      data: { content: null, error: `Could not read file: ${fileName}` },
    });
  }
}

function getWebviewContent(webview: vscode.Webview): string {
  // Use the live URL from your Vercel deployment
  const appUrl = 'https://codeassist-chat-app.vercel.app';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="
            default-src 'none';
            frame-src ${appUrl};
            style-src ${appUrl} 'unsafe-inline';
            script-src ${appUrl};
            font-src https://fonts.gstatic.com;
        ">
        <title>CodeAssist Chat</title>
        <style>
            body, html, iframe {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100vh;
                overflow: hidden;
                border: none;
            }
        </style>
    </head>
    <body>
        <iframe src="${appUrl}"></iframe>
    </body>
    </html>`;
}

// This function is called when your extension is deactivated
export function deactivate() {}
