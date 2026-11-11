// server/src/services/eth.js
// Gas ETH (gwei) via API pública do ethgas.watch

export async function getEthGas() {
  const r = await fetch('https://ethgas.watch/api/gas');
  if (!r.ok) throw new Error(`ethgas.watch ${r.status} ${r.statusText}`);
  const data = await r.json();

  let gwei = null;

  // formato A
  if (typeof data.standard === 'number') gwei = data.standard;
  else if (typeof data.fast === 'number') gwei = data.fast;

  // formato B
  if (!gwei && Array.isArray(data.speeds)) {
    const std = data.speeds.find(s => /standard|normal/i.test(s.name));
    const fast = data.speeds.find(s => /fast/i.test(s.name));
    gwei = std?.gwei ?? fast?.gwei ?? null;
  }

  return { gwei, raw: data, source: 'ethgas.watch' };
}
