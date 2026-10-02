// a fetch with a timeout, then one that may take a minute of the clock
async function run(input) {
  const t0 = Date.now();
  let status = 'ok';
  try {
    const res = await fetch('https://api.example.com/slow', { signal: AbortSignal.timeout(300) });
    await res.json();
  } catch (e) {
    status = e.name;
  }
  await (await fetch('https://api.example.com/tick')).text();
  return { status, elapsedMs: Date.now() - t0 };
}
