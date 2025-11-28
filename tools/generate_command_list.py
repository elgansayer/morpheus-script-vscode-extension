import json
import os

COMMANDS_JSON = "commands.json"
OUTPUT_FILE = "commands.txt"

def main():
    if not os.path.exists(COMMANDS_JSON):
        print(f"Error: {COMMANDS_JSON} not found.")
        return

    try:
        with open(COMMANDS_JSON, 'r', encoding='utf-8') as f:
            commands = json.load(f)
        
        command_names = sorted(commands.keys())
        
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            for cmd in command_names:
                f.write(f"{cmd}\n")
        
        print(f"Successfully wrote {len(command_names)} commands to {OUTPUT_FILE}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
