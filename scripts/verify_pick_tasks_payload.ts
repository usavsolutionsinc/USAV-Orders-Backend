import pool from '../src/lib/db';
import { loadPickTasks } from '../src/lib/picking/sessions';

async function main() {
  const r = await loadPickTasks(2572);
  console.log(JSON.stringify(r, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
