import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';

export async function validateWithSexec(textDocument: TextDocument, sexecPath: string, configuredCommandsTxtPath?: string): Promise<Diagnostic[]> {
    return new Promise<Diagnostic[]>((resolve) => {
        const diagnostics: Diagnostic[] = [];

        if (!sexecPath || !fs.existsSync(sexecPath)) {
            resolve([]);
            return;
        }

        const fileUri = URI.parse(textDocument.uri);

        if (fileUri.scheme !== 'file') {
            resolve([]);
            return;
        }

        const filePath = fileUri.fsPath;
        const fileDir = path.dirname(filePath);
        const fileName = path.basename(filePath);

        // For dirty files, we might want to write to a temp file in the same dir
        // to support relative includes, but for now let's use the saved file
        // or write a temp file if the content doesn't match?
        // Simpler approach: Write content to a temp file in the same directory
        // named .tmp_<filename> to allow relative imports to work (mostly).

        const tempFileName = `.tmp_${fileName}`;
        const tempFilePath = path.join(fileDir, tempFileName);

        // Cleanup function to ensure temp file is removed
        const cleanupTempFile = () => {
            try {
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
            } catch (e) {
                console.error(`Failed to cleanup temp file ${tempFilePath}:`, e);
            }
        };

        try {
            fs.writeFileSync(tempFilePath, textDocument.getText());
        } catch (err) {
            console.error(`Failed to write temp file: ${err}`);
            resolve([]);
            return;
        }

        // Find commands.txt
        // Try to find it in the workspace root or relative to the server
        let commandListPath = '';
        const possiblePaths = [];

        if (configuredCommandsTxtPath) {
            possiblePaths.push(configuredCommandsTxtPath);
        }

        possiblePaths.push(
            path.join(__dirname, '..', '..', '..', 'commands.txt'), // From out/server/src -> root
            path.join(__dirname, '..', '..', 'commands.txt'),       // Fallback
            path.resolve(__dirname, '../../../commands.txt'),       // Alternative resolution
            path.join(process.cwd(), 'commands.txt')                // CWD
        );

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                commandListPath = p;
                break;
            }
        }

        const args = ['-d', fileDir, '-s', tempFileName];
        if (commandListPath) {
            args.push('-e', commandListPath);
        }

        const sexecProcess = spawn(sexecPath, args);

        let output = '';

        sexecProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        sexecProcess.stderr.on('data', (data) => {
            output += data.toString();
        });

        sexecProcess.on('close', () => {
            // Clean up temp file
            cleanupTempFile();

            const lines = output.split('\n');
            // Parse output
            // E: (file, line): message
            // W: (file, line): message
            // E: Script execution failed: ...

            // Regex for E: (file, line): message
            // Note: sexec output format seems to be:
            // E: (filename, line):
            // E: message
            // or
            // W: (filename, line):
            // W: message
            // W: ^
            // W: ^~^~^ Script Warning : message

            // Let's look at the example output again:
            // W: (test_exec.scr, 3):
            // W: exec global/missioncomplete.scr m5l2a
            // W: ^
            // W: ^~^~^ Script Warning : The specified file was not found: ...

            // E: (ai.scr, 196):
            // E: }
            // E: ^
            // E: ^~^~^ Script file compile error: Couldn't parse 'ai.scr': ...

            let currentFile = '';
            let currentLine = 0;
            let currentSeverity: DiagnosticSeverity | null = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                // Match location line: E: (filename, line):
                const locMatch = line.match(/^([EW]): \((.*), (\d+)\):$/);
                if (locMatch) {
                    const type = locMatch[1];
                    currentFile = locMatch[2];
                    currentLine = parseInt(locMatch[3]) - 1; // LSP is 0-indexed
                    currentSeverity = type === 'E' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning;
                    continue;
                }

                // Match message line: X: ^~^~^ Prefix : Message
                const msgMatch = line.match(/^([EW]): \^~\^~\^ (?:Script (?:Warning|file compile error|execution failed)|Couldn't parse '.*'): (.*)$/);
                // Or sometimes just: E: Script execution failed: ...

                // Actually, let's look at the specific error line:
                // E: ^~^~^ Script file compile error: Couldn't parse 'ai.scr': 'syntax error, unexpected TOKEN_RIGHT_BRACES'

                if (line.includes('^~^~^')) {
                    const parts = line.split('^~^~^');
                    if (parts.length > 1) {
                        let message = parts[1].trim();
                        // Clean up prefixes
                        message = message.replace(/^Script (Warning|file compile error|execution failed)\s*:\s*/, '').trim();
                        message = message.replace(/^Couldn't parse '.*'\s*:\s*/, '').trim();

                        if (currentSeverity !== null) {
                            // Only add diagnostic if it matches the current file (ignoring .tmp_ prefix)
                            if (currentFile === tempFileName || currentFile === fileName) {
                                diagnostics.push({
                                    severity: currentSeverity,
                                    range: Range.create(currentLine, 0, currentLine, 2147483647),
                                    message: message,
                                    source: 'morfuse'
                                });
                            }
                            // Reset
                            currentSeverity = null;
                        }
                    }
                }
            }

            resolve(diagnostics);
        });

        sexecProcess.on('error', (err) => {
            console.error(`Failed to spawn sexec: ${err}`);
            cleanupTempFile();
            resolve([]);
        });

        // Ensure cleanup on process exit
        process.on('exit', cleanupTempFile);
    });
}
