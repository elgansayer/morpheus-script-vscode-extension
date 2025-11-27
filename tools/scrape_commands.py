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
    
    # Pattern explanation:
    # Event\s+                  : Match "Event" followed by whitespace
    # (EV_[a-zA-Z0-9_]+)        : Capture Group 1: The event variable (e.g. EV_PlayerStart_EnableSpawn)
    # \s*\(\s*                  : Match opening parenthesis with optional whitespace
    # "([a-zA-Z0-9_]+)"         : Capture Group 2: The command string inside quotes (e.g. enablespawn)
    pattern = re.compile(r'Event\s+(EV_[a-zA-Z0-9_]+)\s*\(\s*"([a-zA-Z0-9_]+)"')

    for dirpath, _, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith(".cpp") or filename.endswith(".h"):
                filepath = os.path.join(dirpath, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        matches = pattern.findall(content)
                        for event_var, command_name in matches:
                            # Use command name as key
                            commands[command_name] = {
                                "event_var": event_var,
                                "file": filename,
                                "args": [], # We don't parse args yet, but keep structure
                                "doc": f"Command: {command_name} (Found in {filename})"
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
