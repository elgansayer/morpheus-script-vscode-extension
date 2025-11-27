import os
import re
import json
import shutil
import subprocess

REPO_URL = "https://github.com/openmoh/openmohaa.git"
TEMP_DIR = "temp_openmohaa"
LOCAL_REPO = "/home/elgan/dev/openmohaa"
OUTPUT_FILE = "commands.json"

def get_repo_dir():
    if os.path.exists(LOCAL_REPO):
        print(f"Using local repository at {LOCAL_REPO}")
        return LOCAL_REPO
    
    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    print(f"Cloning {REPO_URL}...")
    subprocess.run(["git", "clone", "--depth", "1", REPO_URL, TEMP_DIR], check=True)
    return TEMP_DIR

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
    
    # Regex to capture the entire Event definition block
    # Event EV_Name ( ... );
    block_pattern = re.compile(r'Event\s+(EV_[a-zA-Z0-9_]+)\s*\(([^;]+)\);', re.DOTALL)
    
    # Regex to find string literals within the block
    string_pattern = re.compile(r'"([^"]*)"')

    for dirpath, _, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith(".cpp") or filename.endswith(".h"):
                filepath = os.path.join(dirpath, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        blocks = block_pattern.findall(content)
                        
                        for event_var, args_block in blocks:
                            # Extract all string literals from the arguments block
                            strings = string_pattern.findall(args_block)
                            
                            if not strings:
                                continue
                                
                            command_name = strings[0]
                            doc_string = ""
                            
                            # The documentation is usually the last string argument
                            if len(strings) > 1:
                                doc_string = strings[-1]
                                
                                # Heuristic: if the last string is very short (like "i" or "v"), it might not be docs.
                                # But usually docs are the last string.
                                # Let's check if there are 3+ strings, maybe the last one is doc.
                                # In Tow_Entities: "AxisObjNum", "i", "AxisObjNum", "Sets..." -> 4 strings. Last is doc.
                                # In PlayerStart: "enablespawn", "allows..." -> 2 strings. Last is doc.
                                # In some cases: "cmd", "doc" -> 2 strings.
                                
                                # Clean up doc string
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
    repo_dir = None
    try:
        repo_dir = get_repo_dir()
        print("Scanning for commands...")
        commands = find_commands(repo_dir)
        print(f"Found {len(commands)} commands.")
        
        # Sort commands by key
        sorted_commands = dict(sorted(commands.items()))
        
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(sorted_commands, f, indent=4)
        
        print(f"Successfully wrote to {OUTPUT_FILE}")
        
    finally:
        if repo_dir == TEMP_DIR and os.path.exists(TEMP_DIR):
            print("Cleaning up...")
            shutil.rmtree(TEMP_DIR)

if __name__ == "__main__":
    main()
