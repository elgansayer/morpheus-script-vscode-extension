import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    DefinitionParams,
    Definition,
    Location,
    Range,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { validateText, KEYWORDS, MorpheusCommand } from './validator';
import { validateWithSexec } from './sexecValidator';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;



let commands: Record<string, MorpheusCommand> = {};

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasDiagnosticRelatedInformationCapability = !!(
        capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true
            },
            documentFormattingProvider: true,
            definitionProvider: true,
            hoverProvider: true
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }

    // Load commands.json
    loadCommands();
});

async function loadCommands() {
    let configuredPath = '';
    if (hasConfigurationCapability) {
        try {
            const settings = await connection.workspace.getConfiguration({
                section: 'morpheus'
            });
            if (settings && settings.paths && settings.paths.commandsJson) {
                configuredPath = settings.paths.commandsJson;
            }
        } catch (e) {
            connection.console.error(`Failed to load configuration: ${e}`);
        }
    }

    // Look for commands.json relative to the server script
    // When compiled, we are in out/server/src/server.js
    // commands.json is in the root of the extension

    // __dirname points to out/server/src, so we need to go up 3 levels
    const possiblePaths = [];

    if (configuredPath) {
        possiblePaths.push(configuredPath);
    }

    possiblePaths.push(
        path.join(__dirname, '..', '..', '..', 'commands.json'), // From out/server/src -> root
        path.join(__dirname, '..', '..', 'commands.json'),       // Fallback
        path.resolve(__dirname, '../../../commands.json')        // Alternative resolution
    );

    connection.console.log(`Server __dirname: ${__dirname}`);

    let loaded = false;
    for (const commandsPath of possiblePaths) {
        connection.console.log(`Trying to load commands from: ${commandsPath}`);
        if (fs.existsSync(commandsPath)) {
            try {
                const content = fs.readFileSync(commandsPath, 'utf-8');
                commands = JSON.parse(content);
                connection.console.log(`Successfully loaded ${Object.keys(commands).length} commands from ${commandsPath}`);
                loaded = true;
                break;
            } catch (err) {
                connection.console.error(`Failed to parse commands.json from ${commandsPath}: ${err}`);
            }
        } else {
            connection.console.log(`File not found: ${commandsPath}`);
        }
    }

    if (!loaded) {
        connection.console.warn('commands.json not found - hover documentation will not be available');
    }
}

// The settings interface
interface MorpheusSettings {
    morpheus: {
        validation: {
            enable: boolean;
            sexecPath: string;
            trigger: 'onSave' | 'onChange' | 'disabled';
        };
        formatting: {
            enable: boolean;
        };
        paths: {
            commandsJson: string;
            commandsTxt: string;
        };
    };
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: MorpheusSettings = {
    morpheus: {
        validation: {
            enable: true,
            sexecPath: "",
            trigger: "onSave"
        },
        formatting: {
            enable: true
        },
        paths: {
            commandsJson: "",
            commandsTxt: ""
        }
    }
};
let globalSettings: MorpheusSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<MorpheusSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    } else {
        globalSettings = <MorpheusSettings>(
            (change.settings.morpheus || defaultSettings)
        );
    }

    // Revalidate all open text documents
    documents.all().forEach(doc => validateTextDocument(doc, 'onChange'));
});

function getDocumentSettings(resource: string): Thenable<MorpheusSettings> {
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings);
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'morpheus'
        }).then(morpheusSettings => {
            // The result is just the 'morpheus' section, so we wrap it to match our structure
            // actually connection.workspace.getConfiguration returns the section directly if we ask for it
            // but let's be careful about the structure.
            // If we ask for section 'morpheus', we get { validation: ..., formatting: ... }
            // So we need to wrap it.
            return { morpheus: morpheusSettings } as MorpheusSettings;
        });
        documentSettings.set(resource, result);
    }
    return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
    validateTextDocument(change.document, 'onChange');
});

documents.onDidSave(change => {
    validateTextDocument(change.document, 'onSave');
});

// Standard keywords and common commands


async function validateTextDocument(textDocument: TextDocument, trigger: 'onChange' | 'onSave'): Promise<void> {
    const settings = await getDocumentSettings(textDocument.uri);
    if (!settings.morpheus.validation.enable) {
        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
        return;
    }

    const text = textDocument.getText();
    const diagnostics = validateText(text, commands);

    // Run external validator (sexec) based on settings
    const sexecPath = settings.morpheus.validation.sexecPath;
    const validationTrigger = settings.morpheus.validation.trigger;

    let shouldRunSexec = false;
    if (validationTrigger !== 'disabled') {
        if (validationTrigger === 'onChange') {
            shouldRunSexec = true;
        } else if (validationTrigger === 'onSave' && trigger === 'onSave') {
            shouldRunSexec = true;
        }
    }

    if (shouldRunSexec && sexecPath) {
        const commandsTxtPath = settings.morpheus.paths.commandsTxt;
        const sexecDiagnostics = await validateWithSexec(textDocument, sexecPath, commandsTxtPath);
        diagnostics.push(...sexecDiagnostics);
    }

    // Send the computed diagnostics to VSCode.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
    // Monitored files have change in VSCode
    connection.console.log('We received an file change event');
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
    (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
        // The pass parameter contains the position of the text document in
        // which code complete got requested. For the example we ignore this
        // info and always provide the full completion items.

        const items: CompletionItem[] = [];

        for (const [cmd, info] of Object.entries(commands)) {
            items.push({
                label: cmd,
                kind: CompletionItemKind.Function,
                data: info,
                detail: (info as any).doc || cmd
            });
        }

        for (const kw of KEYWORDS) {
            items.push({
                label: kw,
                kind: CompletionItemKind.Keyword,
                data: kw
            });
        }

        return items;
    }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        if (item.data && typeof item.data === 'object' && item.data.doc) {
            item.documentation = item.data.doc;
        }
        return item;
    }
);

connection.onDocumentFormatting(async params => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const settings = await getDocumentSettings(document.uri);
    if (!settings.morpheus.formatting.enable) {
        return [];
    }

    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const edits = [];

    let indentLevel = 0;
    const indentStack: number[] = [];
    let tempIndent = 0;
    let lastLineWasLabel = false;
    const indentChar = params.options.insertSpaces ? ' ' : '\t';
    const indentSize = params.options.insertSpaces ? params.options.tabSize : 1;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // Skip empty lines but preserve them
        if (line.length === 0) {
            continue;
        }

        // Check for case/default
        // These reset indentation to the brace depth + 1, then increment for subsequent lines
        const isCase = /^\s*(case\b|default\s*:)/.test(line);
        if (isCase) {
            if (indentStack.length > 0) {
                indentLevel = indentStack[indentStack.length - 1] + 1;
            }
        }

        // Dedent if line starts with closing brace
        // Sync indentLevel with stack
        if (line.startsWith('}')) {
            if (indentStack.length > 0) {
                indentLevel = indentStack.pop()!;
            } else {
                indentLevel = Math.max(0, indentLevel - 1);
            }
            tempIndent = 0; // Block closed, reset temp indent
        }

        // Dedent if line is 'end'
        // ONLY dedent if we are not in a tempIndent (single-line block)
        // AND if we are not inside braces (indentStack empty)
        // Check case-insensitive for 'end'
        if (/^(end|End|END)$/.test(line) && tempIndent === 0 && indentStack.length === 0) {
            indentLevel = Math.max(0, indentLevel - 1);
        }

        // Handle labels: force 0 indentation (or current level?), but next line should be indented
        // Regex: starts with word characters, ends with colon, optional comments
        // Exclude 'case' and 'default' which are handled separately
        // Allow arguments before the colon (e.g. "Label arg1 arg2:")
        const isLabel = /^\s*(?!(case|default)\b)[a-zA-Z0-9_]+.*:\s*(?:\/\/.*)?$/.test(line);

        let currentIndent = '';
        if (!isLabel) {
            // Apply tempIndent here, BUT not if line starts with { (Allman style)
            let effectiveIndent = indentLevel;

            // Special handling for comments immediately after a label
            // If the last line was a label, we often want the comment to be at the same level (0)
            const isComment = line.startsWith('//');
            if (isComment && lastLineWasLabel) {
                effectiveIndent = Math.max(0, effectiveIndent - 1);
            } else if (!isComment) {
                // If we hit code (non-comment), reset the flag
                lastLineWasLabel = false;
            }

            if (!line.startsWith('{')) {
                effectiveIndent += tempIndent;
            }
            currentIndent = indentChar.repeat(Math.max(0, effectiveIndent) * indentSize);
        } else {
            // Label line itself has 0 indent (or should it be indentLevel?)
            // For top-level labels, indentLevel is usually 0.
            // But if we are inside a block? Morpheus labels are usually top-level.
            // Let's force 0 for now as per user expectation.
            currentIndent = '';

            // But it increases indentation for subsequent lines
            indentLevel++;
            tempIndent = 0; // Reset temp indent on new label/section
            lastLineWasLabel = true;
        }

        // Calculate range for the entire line including existing indentation
        const range = Range.create({ line: i, character: 0 }, { line: i, character: lines[i].length });

        // Only replace if indentation is different
        // We need to preserve the content but replace the indentation
        const trimmedLine = line; // line is already trimmed at start of loop
        // Wait, line was trimmed! We need the original content?
        // No, we construct newText from currentIndent + trimmedLine.
        // But 'line' variable is trimmed.
        // lines[i] is original.
        const originalLine = lines[i];
        const content = originalLine.trimStart();
        const newText = currentIndent + content;

        if (originalLine !== newText) {
            edits.push({
                range: range,
                newText: newText
            });
        }

        // Post-processing for next line state
        const cleanLine = line.replace(/\/\/.*$/, '').trim();

        if (cleanLine.endsWith('{')) {
            indentStack.push(indentLevel);
            indentLevel++;
            tempIndent = 0; // Block started, consumed any pending temp indent
        } else if (isCase) {
            indentLevel++;
        } else if (/^\s*(if|while|for|else|elif)\b/.test(cleanLine)) {
            // Check if it's a single-line control statement
            tempIndent++;
        } else {
            // Normal statement.
            // If we had a tempIndent, it was for THIS statement.
            // So now we are done with it.
            tempIndent = 0;
        }
    }

    return edits;
});

connection.onDefinition((params: DefinitionParams): Definition | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const position = params.position;
    const line = lines[position.line];

    // Simple word extraction at position
    // We want to find the word boundaries around the cursor
    const wordRegex = /[a-zA-Z0-9_]+/g;
    let match;
    let word = '';

    while ((match = wordRegex.exec(line)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        if (position.character >= start && position.character <= end) {
            word = match[0];
            break;
        }
    }

    if (!word) {
        return null;
    }

    // Search for the label definition in the document
    // Label definition format: label:
    const labelRegex = new RegExp(`^\\s*${word}:`);

    for (let i = 0; i < lines.length; i++) {
        if (labelRegex.test(lines[i])) {
            return Location.create(params.textDocument.uri, {
                start: { line: i, character: 0 },
                end: { line: i, character: lines[i].length }
            });
        }
    }

    return null;
});

connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const position = params.position;
    const line = lines[position.line];

    // Simple word extraction at position
    const wordRegex = /[a-zA-Z0-9_]+/g;
    let match;
    let word = '';

    while ((match = wordRegex.exec(line)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        if (position.character >= start && position.character <= end) {
            word = match[0];
            break;
        }
    }

    if (!word) {
        return null;
    }

    // Check if it's a known command
    // Case-insensitive lookup
    const lowerWord = word.toLowerCase();
    const commandKey = Object.keys(commands).find(key => key.toLowerCase() === lowerWord);

    if (commandKey) {
        const commandInfo = commands[commandKey];
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${commandKey}**\n\n${commandInfo.doc}`
            }
        };
    }

    return null;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
