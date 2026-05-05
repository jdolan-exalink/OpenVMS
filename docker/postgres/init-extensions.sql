-- Runs at first DB initialization as the postgres superuser.
-- Enables pgvector so semantic_search plugin can create its tables.
CREATE EXTENSION IF NOT EXISTS vector;
