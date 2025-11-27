import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';

export interface MorpheusCommand {
    event_var: string;
    file: string;
    args: string[];
    doc: string;
}

// Standard keywords and common commands
export const KEYWORDS = [
    'if', 'else', 'while', 'for', 'thread', 'waitthread', 'wait', 'waitframe', 'waittill',
    'end', 'exec', 'exec_server', 'local', 'level', 'game', 'parm', 'group', 'self',
    'spawn', 'delete', 'trigger', 'print', 'println', 'iprintln', 'iprintlnbold',
    'break', 'continue', 'goto', 'return'
];

export function validateText(text: string, commands: Record<string, MorpheusCommand>): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = text.split(/\r?\n/);

    let bracketBalance = 0;
    const definedLabels = new Set<string>();
    const threadCalls: { label: string, line: number, char: number }[] = [];

    // Pass 1: Collect labels and check brackets
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Skip empty lines and comments
        if (trimmedLine.length === 0 || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
            continue;
        }

        // Bracket check
        const openBrackets = (line.match(/{/g) || []).length;
        const closeBrackets = (line.match(/}/g) || []).length;
        bracketBalance += openBrackets - closeBrackets;

        // Label collection
        // Check if line ends with : (ignoring comments)
        let content = trimmedLine;
        const commentIndex = content.indexOf('//');
        if (commentIndex !== -1) {
            content = content.substring(0, commentIndex).trim();
        }

        if (content.endsWith(':')) {
            const match = content.match(/^([a-zA-Z0-9_]+)/);
            if (match) {
                definedLabels.add(match[1]);
            }
        }

        // Thread call collection
        // Matches: thread label, waitthread label, exec label
        // We need to be careful not to match "thread" as a variable or part of a string
        // Simple regex for now: \b(thread|waitthread|exec)\s+([a-zA-Z0-9_]+)
        const threadMatch = line.match(/\b(thread|waitthread|exec)\s+([a-zA-Z0-9_]+)/);
        if (threadMatch) {
            // Check if it's an external script call (contains ::) - actually the regex above won't match ::
            // If the user writes "thread script::label", the regex above might capture "script" as the label if we aren't careful.
            // Let's refine the regex to exclude :: matches or handle them.
            // Actually, if it has ::, it's external, so we ignore it.
            // The regex `([a-zA-Z0-9_]+)` won't match `::`, so `script::label` would fail to match fully or match `script`.
            // Let's check the full token.

            const words = trimmedLine.split(/\s+/);
            for (let j = 0; j < words.length; j++) {
                if (['thread', 'waitthread', 'exec'].includes(words[j]) && j + 1 < words.length) {
                    const target = words[j + 1];
                    // Ignore if it contains :: (external script) or starts with $ (variable)
                    if (!target.includes('::') && !target.startsWith('$') && !target.startsWith('(') && !target.endsWith('.scr')) {
                        // Strip trailing semicolon if present
                        const cleanTarget = target.replace(/;$/, '');
                        threadCalls.push({
                            label: cleanTarget,
                            line: i,
                            char: line.indexOf(cleanTarget)
                        });
                    }
                }
            }
        }

        // Simple Heuristic 1: Check for odd number of quotes
        // This helps detect unclosed strings which can cause syntax errors.
        const quoteCount = (line.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                    start: { line: i, character: 0 },
                    end: { line: i, character: line.length }
                },
                message: 'Line has an odd number of quotes. Check for unclosed strings.',
                source: 'morpheus-lsp'
            });
        }

        // Linter: Check for unknown commands
        // Get the first word of the line
        const match = trimmedLine.match(/^([a-zA-Z0-9_.$]+)/);
        if (match) {
            const firstWord = match[1];

            // Check if it's a label definition (ends with :)
            // We use the previously calculated 'content' which has comments stripped
            if (content.endsWith(':')) {
                continue;
            }

            // Check if it's a variable (starts with $ or contains .)
            if (firstWord.startsWith('$') || firstWord.includes('.')) {
                continue;
            }

            // Check if it's a known command or keyword (case-insensitive)
            const lowerFirstWord = firstWord.toLowerCase();
            const isCommand = Object.keys(commands).some(cmd => cmd.toLowerCase() === lowerFirstWord);
            const isKeyword = KEYWORDS.some(kw => kw.toLowerCase() === lowerFirstWord);

            if (!isCommand && !isKeyword) {
                // Calculate the range of the word
                const startChar = line.indexOf(firstWord);
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: i, character: startChar },
                        end: { line: i, character: startChar + firstWord.length }
                    },
                    message: `Unknown command or keyword: '${firstWord}'`,
                    source: 'morpheus-lsp'
                });
            }
        }
    }

    // Pass 2: Validate thread calls
    for (const call of threadCalls) {
        if (!definedLabels.has(call.label)) {
            // Check if it's a known command or keyword (case-insensitive)
            const lowerLabel = call.label.toLowerCase();
            const isCommand = Object.keys(commands).some(cmd => cmd.toLowerCase() === lowerLabel);
            const isKeyword = KEYWORDS.some(kw => kw.toLowerCase() === lowerLabel);

            if (!isCommand && !isKeyword) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: call.line, character: call.char },
                        end: { line: call.line, character: call.char + call.label.length }
                    },
                    message: `Label '${call.label}' not found in this file.`,
                    source: 'morpheus-lsp'
                });
            }
        }
    }

    // Pass 3: Check bracket balance
    if (bracketBalance !== 0) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: lines.length - 1, character: 0 },
                end: { line: lines.length - 1, character: lines[lines.length - 1].length }
            },
            message: `Unbalanced brackets: ${bracketBalance > 0 ? 'Missing closing }' : 'Missing opening {'}`,
            source: 'morpheus-lsp'
        });
    }

    return diagnostics;
}
