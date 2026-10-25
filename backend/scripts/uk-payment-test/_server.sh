export PORT=4010 STRIPE_API_BASE=http://localhost:4567/v1 STRIPE_SECRET_KEY=sk_test_x STRIPE_WEBHOOK_SECRET=whsec_it APP_URL=http://localhost:3000 CORS_ORIGIN=http://localhost:3000 DATABASE_URL=postgres://postgres@localhost:5433/tovaster SESSION_SECRET=ssssssssssssssssssssssssssssssss NODE_ENV=development
exec npx tsx src/server.ts
