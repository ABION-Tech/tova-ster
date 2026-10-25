export DATABASE_URL=postgres://postgres@localhost:5433/tovaster NODE_ENV=development SESSION_SECRET=x
su postgres -c "/usr/lib/postgresql/16/bin/psql -h /tmp -p 5433 tovaster -qc 'drop schema public cascade; create schema public;'" 2>/dev/null
npx tsx src/db/migrate.ts >/dev/null && npx tsx src/db/seed.ts >/dev/null
