import os
import sqlite3
import json

print("=== AUDIT OF D:\\muti_chat_bot_package ===")
sqlite_files = []
for root, dirs, files in os.walk(r'D:\muti_chat_bot_package'):
    for f in files:
        if f.endswith('.sqlite') or f.endswith('.db'):
            p = os.path.join(root, f)
            sqlite_files.append((p, os.path.getsize(p)))

print(f"Found {len(sqlite_files)} SQLite database files:")
for path, size in sqlite_files:
    print(f"- {path}: {size} bytes")
    if size > 0:
        try:
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            cur.execute("SELECT name, sql FROM sqlite_master WHERE type='table';")
            tables = cur.fetchall()
            print(f"  Found {len(tables)} tables:")
            for tname, sql in tables:
                cur.execute(f"SELECT COUNT(*) FROM \"{tname}\";")
                cnt = cur.fetchone()[0]
                print(f"    * {tname} ({cnt} rows)")
            conn.close()
        except Exception as err:
            print(f"  Error reading {path}: {err}")

# Check python files
py_files = []
for root, dirs, files in os.walk(r'D:\muti_chat_bot_package'):
    if '.venv' in root or '__pycache__' in root or '.pytest_cache' in root:
        continue
    for f in files:
        if f.endswith('.py'):
            py_files.append(os.path.join(root, f))

print(f"\nTotal Python source files (excluding venv/cache): {len(py_files)}")
for p in sorted(py_files)[:25]:
    rel = os.path.relpath(p, r'D:\muti_chat_bot_package')
    print(f"  {rel} ({os.path.getsize(p)} bytes)")
if len(py_files) > 25:
    print(f"  ... and {len(py_files) - 25} more")
