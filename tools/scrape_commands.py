import os
import re
import json
import shutil
import subprocess

REPO_URL = "https://github.com/openmoh/openmohaa.git"
TEMP_DIR = "temp_openmohaa"
OUTPUT_FILE = "commands.json"

def clone_repo():
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    print(f"Cloning {REPO_URL}...")
    subprocess.run(["git", "clone", "--depth", "1", REPO_URL, TEMP_DIR], check=True)

def find_commands(root_dir):
    commands = {}
    # Regex to match Event definitions: Event EV_SomeEvent( "commandname", ... );
    # We want to capture EV_SomeEvent and commandname
    # Example: Event EV_PlayerStart_EnableSpawn( "enablespawn", EV_DEFAULT );
    
    # Regex to match Event definitions: Event EV_SomeEvent( "commandname", ..., "documentation" );
    # We want to capture EV_SomeEvent, commandname, and the documentation string.
    # The documentation string is usually the last argument.
    # Example:
    # Event EV_PlayerStart_EnableSpawn
    # (
    #     "enablespawn",
    #     EV_DEFAULT,
    #     NULL,
    #     NULL,
    #     "allows spawning from this spawnpoint"
    # );
    
    # Regex to match Event definitions: Event EV_SomeEvent( "commandname", ... );
    # We want to capture EV_SomeEvent, commandname, and optionally the documentation string.
    
    # Pattern explanation:
    # Event\s+                  : Match "Event" followed by whitespace
    # (EV_[a-zA-Z0-9_]+)        : Capture Group 1: The event variable
    # [^;]*?                    : Match anything (non-greedy) until we find the command name
    # "([a-zA-Z0-9_]+)"         : Capture Group 2: The command string inside quotes
    # (?:                       : Non-capturing group for the rest
    #   [^;]*?                  : Match anything (non-greedy)
    #   "([^"]*)"               : Capture Group 3: The documentation string inside quotes
    # )?                        : Make the documentation part optional
    # [^;]*?                    : Match anything (non-greedy)
    # \);                       : Match closing parenthesis and semicolon
    
    pattern = re.compile(r'Event\s+(EV_[a-zA-Z0-9_]+)[^;]*?"([a-zA-Z0-9_]+)"(?:[^;]*?"([^"]*)")?[^;]*?\);', re.DOTALL)

    for dirpath, _, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith(".cpp") or filename.endswith(".h"):
                filepath = os.path.join(dirpath, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        matches = pattern.findall(content)
                        for event_var, command_name, doc_string in matches:
                            # Clean up doc string
                            if doc_string:
                                doc_string = " ".join(doc_string.split())
                            else:
                                doc_string = f"Command: {command_name} (Found in {filename})"
                            
                            # Use command name as key
                            commands[command_name] = {
                                "event_var": event_var,
                                "file": filename,
                                "args": [], 
                                "doc": doc_string
                            }
                except Exception as e:
                    print(f"Error reading {filepath}: {e}")
    return commands

def main():
    try:
        clone_repo()
        print("Scanning for commands...")
        commands = find_commands(TEMP_DIR)
        print(f"Found {len(commands)} commands.")
        
        # Sort commands by key
        sorted_commands = dict(sorted(commands.items()))
        
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(sorted_commands, f, indent=4)
        
        print(f"Successfully wrote to {OUTPUT_FILE}")
        
    finally:
        if os.path.exists(TEMP_DIR):
            print("Cleaning up...")
            shutil.rmtree(TEMP_DIR)

if __name__ == "__main__":
    main()
