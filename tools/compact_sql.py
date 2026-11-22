#!/usr/bin/env python3
"""Make a paste-safe copy of a .sql file for the Supabase SQL Editor.

Copying from some viewers turns blank lines and indentation into odd
spaces (non-breaking spaces), which Postgres rejects ("syntax error at or
near ' '"). This drops comment lines, blank lines and indentation, and
refuses any character that is not plain ASCII.

    python3 tools/compact_sql.py supabase/books.sql > out.sql
"""
import sys

src = open(sys.argv[1], encoding='utf-8').read()
bad = sorted({c for c in src if ord(c) > 127})
if bad:
    sys.exit(f'Non-ASCII characters in {sys.argv[1]}: {bad!r}')
lines = [l.strip() for l in src.split('\n')]
title = sys.argv[2] if len(sys.argv) > 2 else 'Paste all of this into Supabase SQL Editor and press Run.'
out = ['-- ' + title] + [l for l in lines if l and not l.startswith('--')]
sys.stdout.write('\n'.join(out) + '\n')
