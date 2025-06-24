import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // This message will show in the Debug Console when the extension starts
  console.log(
    'Congratulations, your extension "codeassist-chat" is now active!'
  );

  const disposable = vscode.commands.registerCommand(
    'codeassist-chat.start',
    () => {
      // This message tells us if the command itself is running
      console.log('Command "codeassist-chat.start" was executed!');

      const panel = vscode.window.createWebviewPanel(
        'codeAssistChat',
        'CodeAssist Chat',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      // Make sure your Next.js dev server is running on port 9002
      panel.webview.html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CodeAssist Chat</title>
                <style>
                    body, html, iframe {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        overflow: hidden;
                        border: none;
                    }
                </style>
            </head>
            <body>
                <iframe src="http://localhost:9002" frameBorder="0"></iframe>
            </body>
            </html>
        `;
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
