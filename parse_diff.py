import re

def parse_diff(file_path):
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        lines = f.readlines()
    
    current_file = None
    file_changes = {}
    hunk_header = None
    
    for line in lines:
        if line.startswith('diff --git'):
            # New file diff
            match = re.search(r'b/(src/\S+|Makefile\S+|config\S+|lib/\S+)', line)
            if match:
                current_file = match.group(1)
            else:
                current_file = line.strip()
            file_changes[current_file] = []
        elif line.startswith('@@'):
            hunk_header = line.strip()
            file_changes[current_file].append(('hunk', hunk_header))
        elif line.startswith('+') and not line.startswith('+++'):
            file_changes[current_file].append(('+', line[1:]))
        elif line.startswith('-') and not line.startswith('---'):
            file_changes[current_file].append(('-', line[1:]))
            
    for fname, changes in file_changes.items():
        if not changes:
            continue
        print(f"========================================")
        print(f"FILE: {fname}")
        print(f"========================================")
        
        # Print a summarized view: only the lines that were added or removed
        # but group them by hunk to see where they are
        for change_type, content in changes:
            if change_type == 'hunk':
                print(f"  {content}")
            elif change_type == '+':
                # print added line, limit length if needed
                print(f"    + {content.strip()}")
            elif change_type == '-':
                # print removed line
                print(f"    - {content.strip()}")
        print("\n")

if __name__ == '__main__':
    parse_diff('diff_w.txt')
