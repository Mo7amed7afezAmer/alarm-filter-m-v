-- Own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';
