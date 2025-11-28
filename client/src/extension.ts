import * as path from 'path';
import { workspace, ExtensionContext, window } from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

// Generate a random debug port between 6010 and 6999 to avoid conflicts
function getDebugPort(): number {
    return Math.floor(Math.random() * 990) + 6010;
}

export function activate(context: ExtensionContext) {
    console.log('Morpheus Script extension is activating...');
    
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
        path.join('out', 'server', 'src', 'server.js')
    );
    
    console.log('Server module path:', serverModule);
    
    // The debug options for the server with dynamic port
    const debugPort = getDebugPort();
    const debugOptions = { execArgv: ['--nolazy', `--inspect=${debugPort}`] };
    console.log(`Debug port: ${debugPort}`);

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for Morpheus script files
        documentSelector: [{ scheme: 'file', language: 'morpheus' }],
        synchronize: {
            // Notify the server about file changes to commands.json
            fileEvents: workspace.createFileSystemWatcher('**/commands.json')
        },
        outputChannelName: 'Morpheus Language Server'
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'morpheusLanguageServer',
        'Morpheus Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client with error handling
    try {
        client.start();
        console.log('Morpheus Script extension activated, language server started successfully.');
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('Failed to start Morpheus language server:', errorMessage);
        window.showErrorMessage(`Failed to start Morpheus Language Server: ${errorMessage}`);
    }
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
