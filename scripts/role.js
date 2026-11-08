// Set a user's role. The only way to create a super_admin.
// Usage: npm run role -- you@example.com super_admin|admin|player
import { neon } from '@neondatabase/serverless';

const [email, role] = process.argv.slice(2);
const ROLES = ['player', 'admin', 'super_admin'];
if (!email || !ROLES.includes(role)) { console.error('Usage: npm run role -- <email> <' + ROLES.join('|') + '>'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`update users set role = ${role} where email = ${email.trim().toLowerCase()} returning id, email, role`;
if (!rows.length) { console.error('No user with that email. They need to sign up first.'); process.exit(1); }
await sql`insert into activity_log (actor_email, actor_role, action, target_user_id, target_email, detail)
          values ('cli', 'system', 'role_set_cli', ${rows[0].id}, ${rows[0].email}, ${JSON.stringify({ role })}::jsonb)`;
console.log('OK', rows[0]);
