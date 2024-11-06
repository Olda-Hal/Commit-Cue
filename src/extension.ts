import * as vscode from 'vscode';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as child_process from 'child_process';
import * as path from 'path';
import { Console } from 'console';
const API_KEY_STORAGE_KEY = '';
dotenv.config();

export async function activate(context: vscode.ExtensionContext) {
    let apiKey = context.globalState.get<string>(API_KEY_STORAGE_KEY);

    if (!apiKey) {
        apiKey = await promptForApiKey();
        if (apiKey) {
            await context.globalState.update(API_KEY_STORAGE_KEY, apiKey);
            vscode.window.showInformationMessage('API key sucessfully saved.');
        } else {
            vscode.window.showWarningMessage('No API key provided. The extension will not work.');
        }
    }
    let disposable = vscode.commands.registerCommand('aicommiter.setApiKey', async () => {
        apiKey = await promptForApiKey();
        if (apiKey) {
            await context.globalState.update(API_KEY_STORAGE_KEY, apiKey);
            vscode.window.showInformationMessage('API key sucessfully saved.');
        } else {
            vscode.window.showWarningMessage('No API key provided. The extension will not work.');
        }
    });


    context.subscriptions.push(disposable)

    vscode.workspace.onDidSaveTextDocument(async (document) => {

        const isInGitRepo = await isGitRepository(document.uri.fsPath);
        if (!isInGitRepo) {
            return;
        }

        const filePath = document.uri.fsPath;
        const gitDiff = getGitDiff(filePath);
        if (gitDiff) {
            const response = await getCommitSuggestion(gitDiff, context);
            if (response && response.shouldCommit) {
                vscode.window.showInformationMessage(
                    `Suggested Commit Message: ${response.commitMessage}`,
                    "Commit",
                    "Commit & Push"
                ).then(selection => {
                    if (selection === "Commit") {
                        executeGitCommand(`git commit -m "${escapeCommitMessage(response.commitMessage)}"`, filePath);
                    } else if (selection === "Commit & Push") {
                        executeGitCommand(`git commit -m "${escapeCommitMessage(response.commitMessage)}" && git push`, filePath);
                    }
                });
            }
        }
    });
}

async function promptForApiKey(): Promise<string | undefined> {
    const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your OpenAI API key',
        placeHolder: 'sk-XXXXXX',
        ignoreFocusOut: true
    });
    return apiKey;
}

function escapeCommitMessage(message: string): string {
    return message
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$');
}

// Funkce pro kontrolu, jestli je soubor v git repozitáři
async function isGitRepository(filePath: string): Promise<boolean> {
    try {
        const gitCommand = `git -C ${path.dirname(filePath)} rev-parse --is-inside-work-tree`;
        const result = child_process.execSync(gitCommand, { encoding: 'utf-8' }).trim();
        return result === 'true';
    } catch (error) {
        return false;
    }
}

function executeGitCommand(command: string, filePath: string) {
    try {
        const result = child_process.execSync(`cd "$(git -C ${path.dirname(filePath)} rev-parse --show-toplevel)" && git add . && ${command}`, { encoding: 'utf-8' });
        vscode.window.showInformationMessage("Sucecssfully executed Git command.");
    } catch (error) {
        vscode.window.showErrorMessage("Failed to execute Git command.");
    }
}

// Funkce pro získání git diff
function getGitDiff(filePath: string): string | null {
    try {
        const gitCommand = `cd "$(git -C ${path.dirname(filePath)} rev-parse --show-toplevel)" && git diff`;
        const diff = child_process.execSync(gitCommand, { encoding: 'utf-8' });
        if (diff) {
            return diff;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Funkce pro zjištění návrhu commit zprávy z OpenAI
async function getCommitSuggestion(content: string, context: vscode.ExtensionContext): Promise<{ shouldCommit: boolean; commitMessage: string } | null> {
    let apiKey = context.globalState.get<string>(API_KEY_STORAGE_KEY);
    if (!apiKey) {
        vscode.window.showErrorMessage('API key is missing...');
        return null;
    }

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are an assistant that gets the output of the command git diff in a repo and determines if these changes should be commited. If the shouldnt answer just with word NO. otherwise answer just with the suggested commit message and nothing else' },
                    { role: 'user', content: `${content}` }
                ],
                max_tokens: 50,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const commitMessage = response.data.choices[0].message.content.trim();
        if (commitMessage.toLowerCase() === 'no') {
            return {
                shouldCommit: false,
                commitMessage: ''
            };
        }
        return {
            shouldCommit: true,
            commitMessage: commitMessage
        };
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to get commit suggestion: ${error}`);
        return null;
    }
}

export function deactivate() {}
