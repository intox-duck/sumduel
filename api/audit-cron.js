// Vercel cron entry point (see "crons" in vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET".
import { route, send, fail } from './_lib.js';
import { runAudit } from './_audit.js';

export default route(['GET'], async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return fail(res, 401, 'Unauthorized');
  const rep = await runAudit(req, { id: null, email: 'cron', role: 'system' }, 'cron');
  send(res, 200, { ok: true, id: String(rep.id), attention: rep.data.attention });
});
