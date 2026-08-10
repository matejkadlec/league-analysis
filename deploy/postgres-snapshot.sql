\set ON_ERROR_STOP on

SELECT 'alembic|' || version_num FROM public.alembic_version;

SELECT format(
    'SELECT %L || count(*) FROM %I.%I;',
    'table|' || schemaname || '.' || tablename || '|',
    schemaname,
    tablename
)
FROM pg_tables
WHERE schemaname IN ('auth', 'core', 'jobs', 'public')
  AND tablename <> 'spatial_ref_sys'
ORDER BY schemaname, tablename
\gexec

SELECT format(
    'SELECT %L || last_value || ''|'' || is_called FROM %I.%I;',
    'sequence|' || schemaname || '.' || sequencename || '|',
    schemaname,
    sequencename
)
FROM pg_sequences
WHERE schemaname IN ('auth', 'core', 'jobs', 'public')
ORDER BY schemaname, sequencename
\gexec

SELECT 'constraints|unvalidated|' || count(*)
FROM pg_constraint
WHERE connamespace IN (
    SELECT oid FROM pg_namespace WHERE nspname IN ('auth', 'core', 'jobs', 'public')
)
AND NOT convalidated;

SELECT
    'admin|mat.kadlec@email.cz|'
    || count(*) || '|'
    || count(*) FILTER (WHERE is_active AND is_admin AND email_verified)
FROM auth.users
WHERE lower(email) = 'mat.kadlec@email.cz';

SELECT
    'admin|marek.hovadik@seznam.cz|'
    || count(*) || '|'
    || count(*) FILTER (WHERE is_active AND is_admin AND email_verified)
FROM auth.users
WHERE lower(email) = 'marek.hovadik@seznam.cz';
