import {
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticRelatedInformation,
    Location,
    Range
} from 'vscode-languageserver/node';

export interface MorpheusCommand {
    event_var: string;
    file: string;
    args: string[];
    doc: string;
}

// Control flow keywords
export const CONTROL_KEYWORDS = [
    'if', 'else', 'while', 'for', 'switch', 'case',
    'break', 'continue', 'goto', 'return',
    'try', 'catch'
];

// Thread/execution keywords
export const THREAD_KEYWORDS = [
    'thread', 'waitthread', 'wait', 'waitframe', 'waittill', 'waitexec',
    'end', 'End', 'END',
    'exec', 'exec_server'
];

// Scope/variable keywords
export const SCOPE_KEYWORDS = [
    'local', 'level', 'game', 'parm', 'group', 'self', 'owner'
];

// Built-in commands
export const BUILTIN_COMMANDS = [
    'spawn', 'delete', 'trigger',
    'print', 'println', 'iprintln', 'iprintlnbold', 'dprintln',
    'makearray', 'makeArray', 'endarray', 'endArray',
    'size'
];

// Constants
export const CONSTANTS = [
    'NULL', 'NIL', 'true', 'false'
];

// All keywords combined
export const KEYWORDS = [
    ...CONTROL_KEYWORDS,
    ...THREAD_KEYWORDS,
    ...SCOPE_KEYWORDS,
    ...BUILTIN_COMMANDS,
    ...CONSTANTS
];

// Valid operators for validation
export const OPERATORS = [
    '=', '+=', '-=',
    '++', '--',
    '==', '!=', '<', '>', '<=', '>=',
    '+', '-', '*', '/', '%',
    '&&', '||', '!',
    '&', '|', '^', '~',
    '::', '.', 
    '[', ']', '(', ')', '{', '}'
];

export function validateText(
    text: string, 
    commands: Record<string, MorpheusCommand>,
    documentUri?: string,
    hasDiagnosticRelatedInfo: boolean = false
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const lines = text.split(/\r?\n/);

    let bracketBalance = 0;
    let parenBalance = 0;
    let squareBracketBalance = 0;
    const definedLabels = new Set<string>();
    const threadCalls: { label: string, line: number, char: number }[] = [];
    let inBlockComment = false;

    // Pass 1: Collect labels and check brackets
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let trimmedLine = line.trim();

        // Handle block comments
        if (inBlockComment) {
            if (trimmedLine.includes('*/')) {
                inBlockComment = false;
                trimmedLine = trimmedLine.substring(trimmedLine.indexOf('*/') + 2).trim();
            } else {
                continue;
            }
        }

        if (trimmedLine.startsWith('/*')) {
            if (!trimmedLine.includes('*/')) {
                inBlockComment = true;
                continue;
            }
            trimmedLine = trimmedLine.substring(trimmedLine.indexOf('*/') + 2).trim();
        }

        // Skip empty lines and line comments
        if (trimmedLine.length === 0 || trimmedLine.startsWith('//')) {
            continue;
        }

        // Bracket checks
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;
        bracketBalance += openBraces - closeBraces;

        const openParens = (line.match(/\(/g) || []).length;
        const closeParens = (line.match(/\)/g) || []).length;
        parenBalance += openParens - closeParens;

        const openSquare = (line.match(/\[/g) || []).length;
        const closeSquare = (line.match(/\]/g) || []).length;
        squareBracketBalance += openSquare - closeSquare;

        // Label collection
        let content = trimmedLine;
        const commentIndex = content.indexOf('//');
        if (commentIndex !== -1) {
            content = content.substring(0, commentIndex).trim();
        }

        // Check for label definition (word followed by colon, but not ::)
        if (content.endsWith(':') && !content.endsWith('::')) {
            const match = content.match(/^([a-zA-Z0-9_]+)/);
            if (match) {
                definedLabels.add(match[1]);
            }
        }

        // Check for case labels
        const caseMatch = content.match(/^case\s+(.+):$/);
        if (caseMatch) {
            // This is a valid case label, skip further processing
            continue;
        }

        // Thread call collection
        const words = trimmedLine.split(/\s+/);
        for (let j = 0; j < words.length; j++) {
            if (['thread', 'waitthread', 'exec'].includes(words[j].toLowerCase()) && j + 1 < words.length) {
                const target = words[j + 1];
                // Ignore if it contains :: (external script) or starts with $ (variable)
                if (!target.includes('::') && !target.startsWith('$') && !target.startsWith('(') && !target.endsWith('.scr')) {
                    const cleanTarget = target.replace(/[;,]$/, '');
                    if (cleanTarget.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
                        threadCalls.push({
                            label: cleanTarget,
                            line: i,
                            char: line.indexOf(cleanTarget)
                        });
                    }
                }
            }
        }

        // Check for odd number of quotes (unclosed strings)
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

        // Check for common syntax errors
        // 1. Assignment in condition (single = in if/while)
        const conditionMatch = trimmedLine.match(/^(if|while)\s*\(?\s*([^)]+)/i);
        if (conditionMatch) {
            const condition = conditionMatch[2];
            // Check for single = that's not == or != or <= or >=
            if (/[^=!<>]=[^=]/.test(condition) && !/==/.test(condition)) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: i, character: 0 },
                        end: { line: i, character: line.length }
                    },
                    message: 'Possible assignment in condition. Did you mean == instead of =?',
                    source: 'morpheus-lsp'
                });
            }
        }

        // Check for unknown commands (first word on line)
        const match = trimmedLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (match) {
            const firstWord = match[1];

            // Skip if it's a label definition
            if (content.endsWith(':') && !content.endsWith('::')) {
                continue;
            }

            // Skip if next char is . (method call on variable)
            const afterWord = trimmedLine.substring(firstWord.length);
            if (afterWord.startsWith('.')) {
                continue;
            }

            // Check if it's a known command or keyword (case-insensitive)
            const lowerFirstWord = firstWord.toLowerCase();
            const isCommand = Object.keys(commands).some(cmd => cmd.toLowerCase() === lowerFirstWord);
            const isKeyword = KEYWORDS.some(kw => kw.toLowerCase() === lowerFirstWord);

            if (!isCommand && !isKeyword) {
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
            const lowerLabel = call.label.toLowerCase();
            const isCommand = Object.keys(commands).some(cmd => cmd.toLowerCase() === lowerLabel);
            const isKeyword = KEYWORDS.some(kw => kw.toLowerCase() === lowerLabel);

            if (!isCommand && !isKeyword) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: call.line, character: call.char },
                        end: { line: call.line, character: call.char + call.label.length }
                    },
                    message: `Label '${call.label}' not found in this file. Is it defined in an external script?`,
                    source: 'morpheus-lsp'
                };

                // Add related information if supported
                if (hasDiagnosticRelatedInfo && documentUri) {
                    // Find similar labels that might be typos
                    const similarLabels = Array.from(definedLabels).filter(label => 
                        label.toLowerCase().includes(call.label.toLowerCase().substring(0, 3)) ||
                        call.label.toLowerCase().includes(label.toLowerCase().substring(0, 3))
                    );
                    
                    if (similarLabels.length > 0) {
                        diagnostic.relatedInformation = similarLabels.slice(0, 3).map(label => {
                            // Find the line where this label is defined
                            let labelLine = 0;
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].trim().startsWith(label + ':')) {
                                    labelLine = i;
                                    break;
                                }
                            }
                            return {
                                location: Location.create(documentUri, Range.create(labelLine, 0, labelLine, label.length)),
                                message: `Did you mean '${label}'?`
                            };
                        });
                    }
                }

                diagnostics.push(diagnostic);
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
            message: `Unbalanced braces: ${bracketBalance > 0 ? `Missing ${bracketBalance} closing }` : `Missing ${-bracketBalance} opening {`}`,
            source: 'morpheus-lsp'
        });
    }

    if (parenBalance !== 0) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: lines.length - 1, character: 0 },
                end: { line: lines.length - 1, character: lines[lines.length - 1].length }
            },
            message: `Unbalanced parentheses: ${parenBalance > 0 ? `Missing ${parenBalance} closing )` : `Missing ${-parenBalance} opening (`}`,
            source: 'morpheus-lsp'
        });
    }

    if (squareBracketBalance !== 0) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: lines.length - 1, character: 0 },
                end: { line: lines.length - 1, character: lines[lines.length - 1].length }
            },
            message: `Unbalanced square brackets: ${squareBracketBalance > 0 ? `Missing ${squareBracketBalance} closing ]` : `Missing ${-squareBracketBalance} opening [`}`,
            source: 'morpheus-lsp'
        });
    }

    return diagnostics;
}
